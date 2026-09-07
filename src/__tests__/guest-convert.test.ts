/**
 * src/__tests__/guest-convert.test.ts
 *
 * POST /api/guest/convert — signup adoption of a guest question (todo:45598ce4).
 *
 * Asserts the in-place adoption: a session is created and the pending guest
 * row is UPDATEd (user_id/session_id set, tier_used→'free', guest_ip
 * cleared) rather than copied; the idempotency guard; and the graceful
 * no-op paths (no cookie, nothing pending, unauthenticated).
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn() }));

import * as db from '@/lib/db';
import * as auth from '@/lib/auth';
import { mintGuestToken, verifyGuestToken, guestTokenHash } from '@/lib/guest';

const mockOne   = db.one           as MockedFunction<typeof db.one>;
const mockExec  = db.exec          as MockedFunction<typeof db.exec>;
const mockQuery = db.query         as MockedFunction<typeof db.query>;
const mockAuth  = auth.requireUser as MockedFunction<typeof auth.requireUser>;

const { POST } = await import('@/app/api/guest/convert/route');

const USER = { id: 'user_1', email: 'a@b.com', tier: 'free' as const, stripe_customer_id: null, payment_state: null };

function req(cookie?: string) {
  return new Request('http://localhost/api/guest/convert', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(USER);
  mockExec.mockResolvedValue(undefined);
});

describe('POST /api/guest/convert', () => {
  it('atomically claims the guest row, creates a session, and attaches it', async () => {
    const token = mintGuestToken();
    const hash = guestTokenHash(verifyGuestToken(token)!);

    mockQuery.mockResolvedValueOnce([{ id: 'q1', query_text: 'What is gnosis?' }]); // claim UPDATE ... RETURNING
    mockOne.mockResolvedValueOnce({ id: 's_new' });                                 // session INSERT

    const res = await POST(req(`guru_guest=${token}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: true, sessionId: 's_new' });

    // Claim is a single atomic UPDATE gated on user_id IS NULL (race guard).
    const [claimSql, claimParams] = mockQuery.mock.calls[0]!;
    expect(claimSql).toMatch(/UPDATE queries SET user_id = \$1/);
    expect(claimSql).toMatch(/WHERE guest_token_hash = \$2 AND user_id IS NULL/);
    expect(claimSql).toMatch(/RETURNING id, query_text/);
    expect(claimParams).toEqual(['user_1', hash]);

    // Session created only after winning the claim (no orphan sessions).
    const [sessionSql, sessionParams] = mockOne.mock.calls[0]!;
    expect(sessionSql).toMatch(/INSERT INTO sessions/i);
    expect(sessionParams).toEqual(['user_1', 'What is gnosis?', 'scholar']);

    // Attach the claimed ids to the session; adopted in place (no copy).
    expect(mockExec).toHaveBeenCalledTimes(1);
    const [attachSql, attachParams] = mockExec.mock.calls[0]!;
    expect(attachSql).toMatch(/UPDATE queries/i);
    expect(attachSql).toMatch(/SET session_id = \$1, tier_used = 'free', guest_ip = NULL/);
    expect(attachSql).toMatch(/WHERE id = ANY\(\$2\)/);
    expect(attachParams).toEqual(['s_new', ['q1']]);

    expect(res.headers.get('set-cookie')).toMatch(/guru_guest=;.*Max-Age=0/);
  });

  it('is a no-op when there is no guest cookie', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: false });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockOne).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('lost race / nothing pending: claims 0 rows → no session created, adopted:false', async () => {
    const token = mintGuestToken();
    mockQuery.mockResolvedValueOnce([]); // claim matched nothing (other tab won, or already converted)

    const res = await POST(req(`guru_guest=${token}`));
    expect((await res.json()).adopted).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the claim
    expect(mockOne).not.toHaveBeenCalled();       // NO orphan session
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated caller', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(req('guru_guest=whatever'));
    expect(res.status).toBe(401);
  });
});
