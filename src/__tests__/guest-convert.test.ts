/**
 * src/__tests__/guest-convert.test.ts
 *
 * POST /api/guest/convert — signup adoption of a guest question
 * (todo:45598ce4, PR #138 review rounds 1–2).
 *
 * The adoption runs in one transaction (withTransaction): a single UPDATE
 * claims + fully converts the row (user_id set, tier→'free', guest_ip shed)
 * gated on user_id IS NULL, then the session is created and attached. Asserts
 * the claim shape, the all-or-nothing rollback on a session-insert failure,
 * the lost-race no-op, and the unauth/no-cookie paths.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn() }));

import * as db from '@/lib/db';
import * as auth from '@/lib/auth';
import { mintGuestToken, verifyGuestToken, guestTokenHash } from '@/lib/guest';

const mockAuth = auth.requireUser   as MockedFunction<typeof auth.requireUser>;
const mockTx   = db.withTransaction as MockedFunction<typeof db.withTransaction>;

const { POST } = await import('@/app/api/guest/convert/route');

const USER = { id: 'user_1', email: 'a@b.com', tier: 'free' as const, stripe_customer_id: null, payment_state: null };

/** A fake pooled client whose query() returns queued results in order. */
function fakeClient(results: Array<{ rows: unknown[] } | Error>) {
  const query = vi.fn().mockImplementation(async () => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next ?? { rows: [] };
  });
  return { query };
}

/** Wire withTransaction to run its callback against a given fake client. */
function runTxWith(client: { query: ReturnType<typeof vi.fn> }) {
  mockTx.mockImplementation(async (fn: (c: never) => unknown) => fn(client as never));
  return client;
}

function req(cookie?: string) {
  return new Request('http://localhost/api/guest/convert', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(USER);
});

describe('POST /api/guest/convert', () => {
  it('claims + converts the row atomically, creates a session, attaches it', async () => {
    const token = mintGuestToken();
    const hash = guestTokenHash(verifyGuestToken(token)!);
    const client = runTxWith(fakeClient([
      { rows: [{ id: 'q1', query_text: 'What is gnosis?' }] }, // claim UPDATE ... RETURNING
      { rows: [{ id: 's_new' }] },                             // session INSERT
      { rows: [] },                                            // attach UPDATE
    ]));

    const res = await POST(req(`guru_guest=${token}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: true, sessionId: 's_new' });

    // Claim sheds IP + flips tier IN the same UPDATE that sets user_id,
    // gated on user_id IS NULL (race guard) — no half-converted row possible.
    const [claimSql, claimParams] = client.query.mock.calls[0]!;
    expect(claimSql).toMatch(/UPDATE queries\s+SET user_id = \$1, tier_used = 'free', guest_ip = NULL/);
    expect(claimSql).toMatch(/WHERE guest_token_hash = \$2 AND user_id IS NULL/);
    expect(claimSql).toMatch(/RETURNING id, query_text/);
    expect(claimParams).toEqual(['user_1', hash]);

    // Session created with free-tier scholar voice, then attached by id.
    expect(client.query.mock.calls[1]![0]).toMatch(/INSERT INTO sessions/i);
    expect(client.query.mock.calls[1]![1]).toEqual(['user_1', 'What is gnosis?', 'scholar']);
    expect(client.query.mock.calls[2]![0]).toMatch(/SET session_id = \$1 WHERE id = ANY\(\$2\)/);
    expect(client.query.mock.calls[2]![1]).toEqual(['s_new', ['q1']]);

    expect(res.headers.get('set-cookie')).toMatch(/guru_guest=;.*Max-Age=0/);
  });

  it('rolls back and 500s if the session insert fails — no half-adopted row', async () => {
    const token = mintGuestToken();
    const client = runTxWith(fakeClient([
      { rows: [{ id: 'q1', query_text: 'q' }] },   // claim
      new Error('sessions insert failed'),          // session INSERT throws → ROLLBACK
    ]));

    const res = await POST(req(`guru_guest=${token}`));
    expect(res.status).toBe(500);
    expect((await res.json()).adopted).toBe(false);
    // The attach UPDATE never ran; the transaction rolled back the claim.
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('lost race / nothing pending: claim matches 0 rows → adopted:false, no session', async () => {
    const token = mintGuestToken();
    const client = runTxWith(fakeClient([{ rows: [] }])); // claim matched nothing

    const res = await POST(req(`guru_guest=${token}`));
    expect((await res.json()).adopted).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(1); // only the claim; no session INSERT
  });

  it('is a no-op when there is no guest cookie (never opens a transaction)', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: false });
    expect(mockTx).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated caller', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(req('guru_guest=whatever'));
    expect(res.status).toBe(401);
    expect(mockTx).not.toHaveBeenCalled();
  });
});
