/**
 * src/__tests__/api.test.ts
 *
 * Unit tests for the API route handlers (sessions, preferences, query).
 * All external deps (db, auth, retriever, model) are mocked.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  one:   vi.fn(),
  exec:  vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
}));

vi.mock('@/lib/prefs', () => ({
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
}));

vi.mock('@/lib/spend', () => ({
  reserveBudget:  vi.fn(),
  finalizeBudget: vi.fn(),
  getBudget:      vi.fn(),
  TIER_LIMITS: {
    free: { query_limit: 10, usd_limit: null },
    pro:  { query_limit: 30, usd_limit: null },
  },
}));

vi.mock('@/lib/cost', () => ({
  computeCost: vi.fn(),
  getPricing:  vi.fn(),
}));

vi.mock('@/lib/retriever', () => ({
  retrieve: vi.fn(),
}));

vi.mock('@/lib/prompt', () => ({
  buildPrompt: vi.fn(),
  SYSTEM_PROMPT: 'mock system prompt',
}));

vi.mock('@/lib/model', async () => {
  // Use real CURATED_MODELS / resolveCuratedModel so the route's
  // slug-resolution logic exercises the production map. Only the
  // network-touching `completeStream` is stubbed.
  const actual = await vi.importActual<typeof import('@/lib/model')>('@/lib/model');
  return {
    ...actual,
    completeStream: vi.fn(),
  };
});

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as db      from '@/lib/db';
import * as auth    from '@/lib/auth';
import * as prefs   from '@/lib/prefs';
import * as spend   from '@/lib/spend';
import * as cost    from '@/lib/cost';
import * as retriever from '@/lib/retriever';
import * as prompt  from '@/lib/prompt';
import * as model   from '@/lib/model';
import * as rl      from '@/lib/rate-limit';

const mockQuery  = db.query      as MockedFunction<typeof db.query>;
const mockOne    = db.one        as MockedFunction<typeof db.one>;
const mockExec   = db.exec       as MockedFunction<typeof db.exec>;
const mockAuth   = auth.requireUser       as MockedFunction<typeof auth.requireUser>;
const mockPrefs  = prefs.loadPreferences  as MockedFunction<typeof prefs.loadPreferences>;
const mockSavePrefs = prefs.savePreferences as MockedFunction<typeof prefs.savePreferences>;
const mockReserveBudget  = spend.reserveBudget  as MockedFunction<typeof spend.reserveBudget>;
const mockFinalizeBudget = spend.finalizeBudget as MockedFunction<typeof spend.finalizeBudget>;
const mockGetBudget      = spend.getBudget      as MockedFunction<typeof spend.getBudget>;
const mockComputeCost    = cost.computeCost     as MockedFunction<typeof cost.computeCost>;
const mockRetrieve = retriever.retrieve   as MockedFunction<typeof retriever.retrieve>;
const mockBuild  = prompt.buildPrompt     as MockedFunction<typeof prompt.buildPrompt>;
const mockStream = model.completeStream   as MockedFunction<typeof model.completeStream>;
const mockRateLimit = rl.rateLimit         as MockedFunction<typeof rl.rateLimit>;

// Default cost mock: every computeCost call returns a tiny estimate so
// reserveBudget never gets a meaningful USD ask in tests that don't
// explicitly care.  Tests that DO care override per-call.
const DEFAULT_COST = {
  cost_usd: 0.001,
  pricing: {
    model_id: 'deepseek/deepseek-chat',
    input_price_per_mtok: 0.14,
    output_price_per_mtok: 0.28,
    cached_input_price_per_mtok: null,
    effective_from: new Date('2026-04-30T00:00:00Z'),
    effective_to:   null,
  },
};
const ALLOWED_RESERVE = {
  allowed: true as const,
  queries_used: 1,
  usd_used:     0.001,
  query_limit:  10,
  usd_limit:    null,
};

const FREE_USER = { id: 'user_1', email: 'a@b.com', tier: 'free' as const, stripe_customer_id: null, payment_state: null };
const DEFAULT_PREFS = {
  scopeMode: 'all' as const,
  blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [],
  preferredModel: null,
};
const PRO_USER  = { id: 'user_2', email: 'p@b.com', tier: 'pro'  as const, stripe_customer_id: 'cus_x', payment_state: null };

// ---------------------------------------------------------------------------
// /api/sessions
// ---------------------------------------------------------------------------

const { GET: sessionsGET, POST: sessionsPOST } = await import('@/app/api/sessions/route');
const { GET: sessionGET } = await import('@/app/api/sessions/[id]/route');
const { GET: prefsGET, PUT: prefsPUT } = await import('@/app/api/preferences/route');
const { POST: queryPOST } = await import('@/app/api/query/route');
const { GET: corpusGET } = await import('@/app/api/corpus/route');

function req(method: string, url: string, body?: object) {
  return new Request(`http://localhost${url}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : {},
  });
}

describe('GET /api/sessions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated sessions', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockQuery.mockResolvedValueOnce([{ id: 's1', title: 'Test', created_at: '', updated_at: '' }]);
    mockOne.mockResolvedValueOnce({ count: '1' });

    const res = await sessionsGET(req('GET', '/api/sessions?limit=10&offset=0'));
    const body = await res.json() as { sessions: unknown[]; total: number };
    expect(res.status).toBe(200);
    expect(body.sessions).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('returns 401 if not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await sessionsGET(req('GET', '/api/sessions'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/sessions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a session and returns 201', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's2', title: 'New session', created_at: '', updated_at: '' });

    const res = await sessionsPOST(req('POST', '/api/sessions', { title: 'New session' }));
    expect(res.status).toBe(201);
  });
});

describe('GET /api/sessions/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns session and messages', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1', title: 'T', created_at: '', updated_at: '' });
    mockQuery.mockResolvedValueOnce([]);

    const res = await sessionGET(req('GET', '/api/sessions/s1'), { params: Promise.resolve({ id: 's1' }) });
    const body = await res.json() as { session: unknown; messages: unknown[] };
    expect(res.status).toBe(200);
    expect(body.session).toBeTruthy();
    expect(body.messages).toHaveLength(0);
  });

  it('returns 404 for unknown session', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce(null);

    const res = await sessionGET(req('GET', '/api/sessions/nope'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });

  it('rehydrates citations from corpus.chunks for messages chunks_used (todo:89af833a)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1', title: 'T', created_at: '', updated_at: '' });
    // 1st mockQuery call: messages with chunks_used. 2nd: corpus.chunks JOIN.
    mockQuery
      .mockResolvedValueOnce([
        { id: 'q1', query_text: 'Q1', response_text: 'A1', chunks_used: ['c.a.001', 'c.b.005'], model_used: 'm', created_at: '' },
        { id: 'q2', query_text: 'Q2', response_text: 'A2', chunks_used: ['c.a.001'],            model_used: 'm', created_at: '' },
      ])
      .mockResolvedValueOnce([
        { id: 'c.a.001', tradition: 'gnosticism',  text_name: 'Gospel of Philip', section: '78' },
        { id: 'c.b.005', tradition: 'neoplatonism', text_name: 'Enneads',          section: 'V.1' },
      ]);

    const res = await sessionGET(req('GET', '/api/sessions/s1'), { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { messages: Array<{ chunks_used: string[]; citations: Array<{ tradition: string; text: string; section: string; tier: string }> }> };

    // Single batched JOIN — chunks lookup ran exactly once across both messages.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const chunksLookupCall = mockQuery.mock.calls[1]!;
    expect(chunksLookupCall[0]).toContain('FROM corpus.chunks');
    expect(chunksLookupCall[0]).toContain('id = ANY($1::text[])');
    // Unique chunk IDs only (c.a.001 appears in two messages, sent once).
    expect(chunksLookupCall[1]).toEqual([expect.arrayContaining(['c.a.001', 'c.b.005'])]);
    expect((chunksLookupCall[1] as [string[]])[0]).toHaveLength(2);

    // Citations attached per message in chunks_used order.
    expect(body.messages[0]!.citations).toEqual([
      { tradition: 'gnosticism',   text: 'Gospel of Philip', section: '78',  tier: 'verified' },
      { tradition: 'neoplatonism', text: 'Enneads',          section: 'V.1', tier: 'verified' },
    ]);
    expect(body.messages[1]!.citations).toEqual([
      { tradition: 'gnosticism', text: 'Gospel of Philip', section: '78', tier: 'verified' },
    ]);
  });

  it('skips the corpus.chunks lookup entirely when no messages cite anything', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1', title: 'T', created_at: '', updated_at: '' });
    mockQuery.mockResolvedValueOnce([
      { id: 'q1', query_text: 'Q', response_text: 'A', chunks_used: [], model_used: 'm', created_at: '' },
    ]);

    const res = await sessionGET(req('GET', '/api/sessions/s1'), { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(200);
    // Only the queries SELECT — no chunks JOIN since there's nothing to look up.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const body = await res.json() as { messages: Array<{ citations: unknown[] }> };
    expect(body.messages[0]!.citations).toEqual([]);
  });
});

describe('GET /api/preferences', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns user preferences', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);

    const res = await prefsGET();
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(res.status).toBe(200);
    expect(body.scopeMode).toBe('all');
  });
});

describe('PUT /api/preferences', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges and saves updated prefs', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockSavePrefs.mockResolvedValueOnce(undefined);

    const res = await prefsPUT(req('PUT', '/api/preferences', { scopeMode: 'blacklist' }));
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(res.status).toBe(200);
    expect(body.scopeMode).toBe('blacklist');
  });

  it('rejects invalid scopeMode', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);

    const res = await prefsPUT(req('PUT', '/api/preferences', { scopeMode: 'invalid' }));
    expect(res.status).toBe(400);
  });
});

// ── preferredModel validation (todo:f764d5dc / C5 picker) ────────────
// Separate describe block with vi.resetAllMocks so queued mock returns
// from earlier tests (e.g., the 'rejects invalid scopeMode' test which
// queues but never consumes mockPrefs) don't bleed into these.
describe('PUT /api/preferences — preferredModel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('accepts a valid preferredModel slug and persists it', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockSavePrefs.mockResolvedValueOnce(undefined);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredModel: 'anthropic' }));
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(res.status).toBe(200);
    expect(body.preferredModel).toBe('anthropic');
    const [, savedPrefs] = mockSavePrefs.mock.calls[0]!;
    expect(savedPrefs.preferredModel).toBe('anthropic');
  });

  it('accepts null preferredModel (clears the preference)', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredModel: 'anthropic' });
    mockSavePrefs.mockResolvedValueOnce(undefined);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredModel: null }));
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(res.status).toBe(200);
    expect(body.preferredModel).toBeNull();
  });

  it('keeps existing preferredModel when field absent from body', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredModel: 'xai' });
    mockSavePrefs.mockResolvedValueOnce(undefined);

    const res = await prefsPUT(req('PUT', '/api/preferences', { scopeMode: 'all' }));
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(body.preferredModel).toBe('xai');
  });

  it('rejects invalid preferredModel slug with 400', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredModel: 'frontier-bogus' }));
    expect(res.status).toBe(400);
    expect(mockSavePrefs).not.toHaveBeenCalled();
  });
});

describe('GET /api/corpus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 if not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await corpusGET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('aggregates DISTINCT (tradition, text_name) chunk rows into the catalog shape', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockQuery.mockResolvedValueOnce([
      { tradition: 'Gnosticism', text_name: 'Gospel of Thomas' },
      { tradition: 'Gnosticism', text_name: 'Gospel of Philip' },
      { tradition: 'Taoism',     text_name: 'Tao Te Ching' },
    ]);

    const res = await corpusGET();
    const body = await res.json() as { traditions: Record<string, { texts: string[] }> };
    expect(res.status).toBe(200);
    expect(body.traditions).toEqual({
      Gnosticism: { texts: ['Gospel of Thomas', 'Gospel of Philip'] },
      Taoism:     { texts: ['Tao Te Ching'] },
    });

    const [sql] = mockQuery.mock.calls[0]!;
    expect(sql).toMatch(/SELECT\s+DISTINCT\s+tradition,\s*text_name\s+FROM\s+chunks/i);
  });

  it('returns an empty catalog when chunks is empty (no fallback)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockQuery.mockResolvedValueOnce([]);

    const res = await corpusGET();
    const body = await res.json() as { traditions: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(body.traditions).toEqual({});
  });
});

describe('POST /api/query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rate-limit allows. Tests that exercise the 429 path override.
    mockRateLimit.mockResolvedValue({ allowed: true });
  });

  it('returns 429 with Retry-After when rate-limited', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3 });

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3');
    // Must short-circuit before hitting any of the heavier mocks.
    expect(mockOne).not.toHaveBeenCalled();
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockReserveBudget).not.toHaveBeenCalled();
  });

  it('returns 429 with reason=queries when query limit exceeded', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('prompt');
    mockComputeCost.mockResolvedValueOnce(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce({
      allowed: false, reason: 'queries',
      queries_used: 10, usd_used: 0,
      query_limit: 10, usd_limit: null,
    });

    const res = await queryPOST(req('POST', '/api/query', { query: 'test', sessionId: 's1' }));
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; reason: string };
    expect(body.reason).toBe('queries');
    // Unified user-facing message regardless of axis (todo:e8105324) —
    // 'reason' on the body stays for log/admin telemetry but the
    // string the user sees doesn't branch on it.
    expect(body.error).toMatch(/Daily question limit/);
  });

  it('returns 429 with reason=usd when spend cap would overrun (same user-facing message)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('prompt');
    mockComputeCost.mockResolvedValueOnce(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce({
      allowed: false, reason: 'usd',
      queries_used: 5, usd_used: 0.49,
      query_limit: 30, usd_limit: 0.50,
    });

    const res = await queryPOST(req('POST', '/api/query', { query: 'test', sessionId: 's1' }));
    expect(res.status).toBe(429);
    const body = await res.json() as { reason: string; error: string };
    expect(body.reason).toBe('usd');
    // Same user-facing copy as reason=queries — USD axis hidden from
    // user (todo:e8105324).
    expect(body.error).toMatch(/Daily question limit/);
    // The phrase 'spend' must NOT appear — that would leak the
    // dollar mechanism we deliberately abstracted.
    expect(body.error).not.toMatch(/spend/i);
  });

  it('returns 404 when sessionId belongs to another user', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce(null); // ownership SELECT finds no row → not owned
    mockExec.mockResolvedValue(undefined);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 'foreign_session' }));
    expect(res.status).toBe(404);

    // Regression: must check user_id, not just session id
    const [sql, params] = mockOne.mock.calls[0]!;
    expect(sql).toMatch(/FROM\s+sessions\s+WHERE\s+id\s*=\s*\$1\s+AND\s+user_id\s*=\s*\$2/i);
    expect(params).toEqual(['foreign_session', 'user_1']);

    // No retrieval, no quota burn, no INSERT
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockReserveBudget).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('returns 400 for missing query', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);

    const res = await queryPOST(req('POST', '/api/query', {}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when query exceeds 4000-char hard cap', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    const oversize = 'a'.repeat(4001);

    const res = await queryPOST(req('POST', '/api/query', { query: oversize, sessionId: 's1' }));
    const body = await res.json() as { error: string; limit: number; length: number };
    expect(res.status).toBe(400);
    expect(body.limit).toBe(4000);
    expect(body.length).toBe(4001);
    // Cap fires before any downstream work.
    expect(mockOne).not.toHaveBeenCalled();
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockReserveBudget).not.toHaveBeenCalled();
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('accepts query exactly at 4000 chars (boundary)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('p');
    mockExec.mockResolvedValue(undefined);
    async function* s() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(s() as never);

    const atLimit = 'a'.repeat(4000);
    const res = await queryPOST(req('POST', '/api/query', { query: atLimit, sessionId: 's1' }));
    expect(res.status).toBe(200);
  });

  it('streams response when budget allows', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);

    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'Hello ' } }] };
      yield { choices: [{ delta: { content: 'world' } }] };
    }
    mockStream.mockResolvedValueOnce(fakeStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'What is gnosis?', sessionId: 's1' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Quota-Used')).toBe('1');
    expect(res.headers.get('X-Quota-Limit')).toBe('10');
    expect(res.headers.get('X-Spend-Used')).toBe('0.001');
    expect(res.headers.get('X-Spend-Limit')).toBe('unlimited');
    // Resolved model id surfaced in headers so the chat-view can
    // render the attribution line during the live stream (BRD §7.4).
    // Free tier always resolves to the deepseek default.
    expect(res.headers.get('X-Model-Used')).toBe('deepseek/deepseek-v4-pro');

    const text = await res.text();
    expect(text).toBe('Hello world');
  });

  it('persists token counts + cost_usd from final usage chunk', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    // computeCost is called twice: pre-flight estimate, post-stream actual.
    // Pre-flight uses worst-case tokens (8K output); post-flight uses real
    // (42 prompt / 7 completion).  Distinct return values let us assert the
    // POST-stream cost lands in queries.cost_usd, not the estimate.
    mockComputeCost
      .mockResolvedValueOnce({ ...DEFAULT_COST, cost_usd: 0.05 }) // estimate
      .mockResolvedValueOnce({ ...DEFAULT_COST, cost_usd: 0.0042 }); // actual
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);

    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'Hi' } }] };
      // Usage chunk: OpenAI shape — empty choices[], top-level usage.
      yield { choices: [], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } };
    }
    mockStream.mockResolvedValueOnce(fakeStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
    await res.text();

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExec.mock.calls[0]!;
    expect(sql).toContain('input_tokens');
    expect(sql).toContain('output_tokens');
    expect(sql).toContain('cached_input_tokens');
    expect(sql).toContain('cost_usd');
    expect(params).toHaveLength(11);
    expect(params![7]).toBe(42);   // input_tokens
    expect(params![8]).toBe(7);    // output_tokens
    expect(params![9]).toBe(0);    // cached_input_tokens — usage chunk omitted it, default 0
    expect(params![10]).toBe(0.0042); // cost_usd from POST-stream computeCost

    // finalizeBudget reconciles with the actual cost (0.0042) vs estimate (0.05)
    expect(mockFinalizeBudget).toHaveBeenCalledOnce();
    expect(mockFinalizeBudget).toHaveBeenCalledWith({
      userId: 'user_1',
      estimatedCostUsd: 0.05,
      actualCostUsd: 0.0042,
    });
  });

  it('reads cached_tokens from prompt_tokens_details when present (OpenAI shape)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('p');
    mockExec.mockResolvedValue(undefined);

    async function* withCache() {
      yield { choices: [{ delta: { content: 'x' } }] };
      yield {
        choices: [],
        usage: {
          prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      };
    }
    mockStream.mockResolvedValueOnce(withCache() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
    await res.text();

    const [, params] = mockExec.mock.calls[0]!;
    expect(params![9]).toBe(80); // cached_input_tokens read from prompt_tokens_details
  });

  it('writes NULL token counts + NULL cost_usd when stream truncates before usage', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);

    async function* truncatedStream() {
      yield { choices: [{ delta: { content: 'partial' } }] };
      throw new Error('connection reset');
    }
    mockStream.mockResolvedValueOnce(truncatedStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
    await res.text();

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [, params] = mockExec.mock.calls[0]!;
    expect(params![7]).toBeNull();  // input_tokens — usage chunk never arrived
    expect(params![8]).toBeNull();  // output_tokens
    expect(params![10]).toBeNull(); // cost_usd — estimate stays in usd_used; persisted cost is honest about not knowing

    // No finalize when we don't have actual usage — estimate remains in usd_used.
    expect(mockFinalizeBudget).not.toHaveBeenCalled();
  });

  it('persists partial response when client cancels mid-stream (todo:9dff8966)', async () => {
    // Regression: the controller transitions to a closed/errored state when
    // the consumer cancels, so the next controller.enqueue() throws
    // "Invalid state: Controller is already closed". Without the safeClose
    // guard, finally's controller.close() also throws and the persistence
    // block at the end of start() never runs — losing the partial response.

    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);

    // Slow stream so we can cancel between chunks and the loop body
    // re-enters enqueue against a now-closed controller.
    async function* slowStream() {
      for (let i = 0; i < 5; i++) {
        yield { choices: [{ delta: { content: `c${i} ` } }] };
        await new Promise(r => setTimeout(r, 5));
      }
    }
    mockStream.mockResolvedValueOnce(slowStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));

    // Read first chunk, then cancel — simulates client disconnect.
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    // Give start() time to finish the catch+finally+persist sequence.
    await new Promise(r => setTimeout(r, 100));

    // Persistence MUST still run — the partial response is the user's record.
    expect(mockExec).toHaveBeenCalledTimes(1);
    const [, params] = mockExec.mock.calls[0]!;
    expect(typeof params![3]).toBe('string'); // response_text — partial is fine
  });
});

// ── Curated model slug resolution (todo:ae3e5de8) ──────────────────────
// Separate describe block with its own beforeEach so we get a clean
// mock queue (vi.resetAllMocks vs the parent block's clearAllMocks —
// resetAllMocks also wipes queued mockResolvedValueOnce values that
// can leak from earlier tests).
//
// Asserts the BRD §7.2 contract: pro consults preferred_model from
// user_preferences; free is always pinned to the default regardless
// of saved value. The resolved OpenRouter id is what's passed to
// completeStream and stored in queries.model_used.

describe('POST /api/query — curated slug resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRateLimit.mockResolvedValue({ allowed: true });
  });

  async function runQueryWithPrefs(user: typeof FREE_USER | typeof PRO_USER, preferredModel: string | null) {
    mockAuth.mockResolvedValueOnce(user);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredModel });
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('p');
    mockExec.mockResolvedValue(undefined);
    async function* s() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(s() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
    await res.text();
    return res;
  }

  it('pro user with preferredModel=anthropic resolves to sonnet-4.6', async () => {
    await runQueryWithPrefs(PRO_USER, 'anthropic');
    const [streamPrompt, modelId] = mockStream.mock.calls[0]!;
    expect(streamPrompt).toBe('p');
    expect(modelId).toBe('anthropic/claude-sonnet-4.6');
    const [, persistParams] = mockExec.mock.calls[0]!;
    expect(persistParams![5]).toBe('anthropic/claude-sonnet-4.6');
  });

  it('pro user with preferredModel=null falls through to deepseek default', async () => {
    await runQueryWithPrefs(PRO_USER, null);
    const [, modelId] = mockStream.mock.calls[0]!;
    expect(modelId).toBe('deepseek/deepseek-v4-pro');
    const [, persistParams] = mockExec.mock.calls[0]!;
    expect(persistParams![5]).toBe('deepseek/deepseek-v4-pro');
  });

  it('free user with any preferredModel value still resolves to default', async () => {
    await runQueryWithPrefs(FREE_USER, 'anthropic');
    const [, modelId] = mockStream.mock.calls[0]!;
    expect(modelId).toBe('deepseek/deepseek-v4-pro');
  });

  it('pro user with stale/unknown slug (post-rename) falls through to default', async () => {
    await runQueryWithPrefs(PRO_USER, 'old-removed-slug');
    const [, modelId] = mockStream.mock.calls[0]!;
    expect(modelId).toBe('deepseek/deepseek-v4-pro');
  });
});
