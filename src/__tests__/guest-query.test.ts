/**
 * src/__tests__/guest-query.test.ts
 *
 * POST /api/query/guest — the anonymous first-question path (todo:2d4bdd96).
 *
 * Asserts the guest contract: a real streamed answer + citations, a single
 * queries row persisted with user_id/session_id NULL and tier_used='guest'
 * (cost + ip_name populated), the one-free-question token gate, the per-IP
 * backstop, no authenticated-side writes, and tamper handling.
 *
 * db, retriever, prompt(build), model and cost are mocked; the real guest
 * entitlement gate runs (its in-memory limiter is reset per test).
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));
vi.mock('@/lib/retriever', () => ({ retrieve: vi.fn(), getChunkById: vi.fn() }));
vi.mock('@/lib/prompt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/prompt')>('@/lib/prompt');
  return { ...actual, buildPrompt: vi.fn(), getSystemPrompt: vi.fn(() => 'mock system prompt') };
});
vi.mock('@/lib/model', () => ({ completeStream: vi.fn() }));
vi.mock('@/lib/cost', () => ({ computeCost: vi.fn(), getPricing: vi.fn() }));

import * as db from '@/lib/db';
import * as retriever from '@/lib/retriever';
import * as prompt from '@/lib/prompt';
import * as model from '@/lib/model';
import * as cost from '@/lib/cost';
import { resetIpRateLimiter } from '@/lib/ip-rate-limit';

const mockExec     = db.exec               as MockedFunction<typeof db.exec>;
const mockOne      = db.one                as MockedFunction<typeof db.one>;
const mockRetrieve = retriever.retrieve    as MockedFunction<typeof retriever.retrieve>;
const mockBuild    = prompt.buildPrompt    as MockedFunction<typeof prompt.buildPrompt>;
const mockStream   = model.completeStream  as MockedFunction<typeof model.completeStream>;
const mockCost     = cost.computeCost      as MockedFunction<typeof cost.computeCost>;

const { POST: guestPOST } = await import('@/app/api/query/guest/route');

const CHUNK = {
  id: 'c1', tradition: 'gnosticism', text_name: 'Apocryphon of John', section: '1.1',
} as never;
const DEFAULT_COST = { cost_usd: 0.002, pricing: {} as never };

function fakeStream() {
  return (async function* () {
    yield { choices: [{ delta: { content: 'The ' } }] };
    yield { choices: [{ delta: { content: 'answer.' } }] };
    yield { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } };
  })();
}

function req(body: object, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/query/guest', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Let the post-stream onComplete (cost + persist) settle after draining. */
const flush = () => new Promise((r) => setTimeout(r, 10));

function tokenFromSetCookie(res: Response): string {
  const sc = res.headers.get('set-cookie') ?? '';
  const m = sc.match(/guru_guest=([^;]+)/);
  if (!m) throw new Error(`no guru_guest cookie in: ${sc}`);
  return m[1]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetIpRateLimiter();
  mockRetrieve.mockResolvedValue([CHUNK]);
  mockBuild.mockReturnValue('assembled prompt');
  mockCost.mockResolvedValue(DEFAULT_COST);
  mockStream.mockImplementation(async () => fakeStream() as never);
  mockExec.mockResolvedValue(undefined);
});

describe('POST /api/query/guest — happy path', () => {
  it('streams the real answer with citations and a model header', async () => {
    const res = await guestPOST(req({ query: 'What is gnosis?' }, { 'x-forwarded-for': '203.0.113.5' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Used')).toBe('deepseek/deepseek-v4-pro');
    expect(res.headers.get('X-Guest-Remaining')).toBe('0');
    expect(res.headers.get('X-Citations')).toBeTruthy();
    expect(res.headers.get('set-cookie')).toMatch(/guru_guest=.+; Path=\/; HttpOnly/);
    const text = await res.text();
    expect(text).toBe('The answer.');
  });

  it('persists exactly one guest row: user_id/session_id NULL, tier_used=guest, cost+ip_name set', async () => {
    const res = await guestPOST(req({ query: 'What is gnosis?' }, { 'x-forwarded-for': '203.0.113.5' }));
    await res.text();
    await flush();

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExec.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO queries/i);
    expect(sql).toMatch(/VALUES \(NULL, NULL,/);      // no user_id, no session_id
    expect(sql).toMatch(/'guest'/);                    // tier_used pinned
    // params: query_text, response_text, chunks_used, model, in, out, cached, cost, ip, ip_name, token_hash
    expect(params![0]).toBe('What is gnosis?');
    expect(params![1]).toBe('The answer.');
    expect(params![7]).toBe(0.002);                    // cost_usd tracked
    expect(params![8]).toBe('203.0.113.5');            // guest_ip
    expect(typeof params![9]).toBe('string');          // ip_name
    expect((params![9] as string).length).toBeGreaterThan(0);
    expect(typeof params![10]).toBe('string');         // guest_token_hash

    // No authenticated-side writes: sessions insert / lookup uses one(), never called.
    expect(mockOne).not.toHaveBeenCalled();
  });
});

describe('POST /api/query/guest — entitlement gate', () => {
  it('refuses the second question on the same token (one-shot)', async () => {
    const first = await guestPOST(req({ query: 'q1' }, { 'x-forwarded-for': '10.0.0.1' }));
    await first.text();
    const token = tokenFromSetCookie(first);

    mockStream.mockClear();
    const second = await guestPOST(
      req({ query: 'q2' }, { 'x-forwarded-for': '10.0.0.1', cookie: `guru_guest=${token}` }),
    );
    expect(second.status).toBe(429);
    expect((await second.json()).reason).toBe('token');
    expect(mockStream).not.toHaveBeenCalled(); // no generation on a denied request
  });

  it('IP backstop: fresh token each time from one IP is capped', async () => {
    let allowed = 0;
    let denied = 0;
    let lastReason: string | undefined;
    for (let i = 0; i < 12; i++) {
      // No cookie ⇒ a fresh token every call (models cookie-clearing).
      const res = await guestPOST(req({ query: `q${i}` }, { 'x-forwarded-for': '8.8.8.8' }));
      if (res.status === 200) { allowed++; await res.text(); }
      else { denied++; lastReason = (await res.json()).reason; }
    }
    expect(allowed).toBeGreaterThan(0);
    expect(denied).toBeGreaterThan(0);
    expect(lastReason).toBe('ip'); // token layer never trips; IP layer does
  });
});

describe('POST /api/query/guest — robustness', () => {
  it('treats a tampered cookie as a fresh guest (mints a new token, still serves)', async () => {
    const res = await guestPOST(
      req({ query: 'q' }, { 'x-forwarded-for': '1.2.3.4', cookie: 'guru_guest=forged.deadbeef' }),
    );
    expect(res.status).toBe(200);
    expect(tokenFromSetCookie(res)).not.toBe('forged.deadbeef');
    await res.text();
  });

  it('400s an empty query', async () => {
    const res = await guestPOST(req({ query: '   ' }, { 'x-forwarded-for': '1.2.3.4' }));
    expect(res.status).toBe(400);
    expect(mockStream).not.toHaveBeenCalled();
  });
});
