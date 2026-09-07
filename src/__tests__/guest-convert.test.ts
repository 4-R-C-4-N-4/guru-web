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

const mockOne  = db.one           as MockedFunction<typeof db.one>;
const mockExec = db.exec          as MockedFunction<typeof db.exec>;
const mockAuth = auth.requireUser as MockedFunction<typeof auth.requireUser>;

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
  it('adopts the pending guest row in place and returns the new session', async () => {
    const token = mintGuestToken();
    const hash = guestTokenHash(verifyGuestToken(token)!);

    mockOne
      .mockResolvedValueOnce({ id: 'q1', query_text: 'What is gnosis?' }) // pending SELECT
      .mockResolvedValueOnce({ id: 's_new' });                            // session INSERT

    const res = await POST(req(`guru_guest=${token}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: true, sessionId: 's_new' });

    // Session created for the user with free-tier scholar voice.
    const [sessionSql, sessionParams] = mockOne.mock.calls[1]!;
    expect(sessionSql).toMatch(/INSERT INTO sessions/i);
    expect(sessionParams).toEqual(['user_1', 'What is gnosis?', 'scholar']);

    // Row adopted in place — UPDATE, not a second INSERT into queries.
    expect(mockExec).toHaveBeenCalledTimes(1);
    const [updSql, updParams] = mockExec.mock.calls[0]!;
    expect(updSql).toMatch(/UPDATE queries/i);
    expect(updSql).toMatch(/SET user_id = \$1, session_id = \$2, tier_used = 'free', guest_ip = NULL/);
    expect(updSql).toMatch(/WHERE guest_token_hash = \$3 AND user_id IS NULL/); // idempotent
    expect(updParams).toEqual(['user_1', 's_new', hash]);

    // Guest cookie is expired so a refresh can't re-fire.
    expect(res.headers.get('set-cookie')).toMatch(/guru_guest=;.*Max-Age=0/);
  });

  it('is a no-op when there is no guest cookie', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: false });
    expect(mockOne).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('is a no-op when the token has no pending row (already converted / cleared)', async () => {
    const token = mintGuestToken();
    mockOne.mockResolvedValueOnce(null); // pending SELECT misses

    const res = await POST(req(`guru_guest=${token}`));
    expect((await res.json()).adopted).toBe(false);
    expect(mockOne).toHaveBeenCalledTimes(1);       // only the SELECT
    expect(mockExec).not.toHaveBeenCalled();          // no session, no update
  });

  it('401s an unauthenticated caller', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(req('guru_guest=whatever'));
    expect(res.status).toBe(401);
  });
});
