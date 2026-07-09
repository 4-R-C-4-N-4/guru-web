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

vi.mock('@/lib/prompt', async () => {
  // Use the real isVoiceSlug + DEFAULT_VOICE so the route's tier-gated
  // voice resolution exercises production logic. Only buildPrompt
  // (network-adjacent) and getSystemPrompt (large string) are stubbed.
  const actual = await vi.importActual<typeof import('@/lib/prompt')>('@/lib/prompt');
  return {
    ...actual,
    buildPrompt: vi.fn(),
    buildStudyPrompt: vi.fn(),
    getSystemPrompt: vi.fn(() => 'mock system prompt'),
  };
});

vi.mock('@/lib/dossier', () => ({
  getDossierForText: vi.fn(),
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
// summarizeExpansion runs on the query path; default to no expansion so existing
// query tests are unaffected, override per-test for the transparency header.
vi.mock('@/lib/graph', () => ({
  summarizeExpansion: vi.fn().mockResolvedValue([]),
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
import * as graph   from '@/lib/graph';
import * as prompt  from '@/lib/prompt';
import * as dossierLib from '@/lib/dossier';
import * as model   from '@/lib/model';
import * as rl      from '@/lib/rate-limit';

const mockQuery  = db.query      as MockedFunction<typeof db.query>;
const mockOne    = db.one        as MockedFunction<typeof db.one>;
const mockExec   = db.exec       as MockedFunction<typeof db.exec>;
const mockAuth   = auth.requireUser       as MockedFunction<typeof auth.requireUser>;
const mockSummarize = graph.summarizeExpansion as MockedFunction<typeof graph.summarizeExpansion>;
const mockPrefs  = prefs.loadPreferences  as MockedFunction<typeof prefs.loadPreferences>;
const mockSavePrefs = prefs.savePreferences as MockedFunction<typeof prefs.savePreferences>;
const mockReserveBudget  = spend.reserveBudget  as MockedFunction<typeof spend.reserveBudget>;
const mockFinalizeBudget = spend.finalizeBudget as MockedFunction<typeof spend.finalizeBudget>;
const mockComputeCost    = cost.computeCost     as MockedFunction<typeof cost.computeCost>;
const mockRetrieve = retriever.retrieve   as MockedFunction<typeof retriever.retrieve>;
const mockBuild  = prompt.buildPrompt     as MockedFunction<typeof prompt.buildPrompt>;
const mockBuildStudy = prompt.buildStudyPrompt as MockedFunction<typeof prompt.buildStudyPrompt>;
const mockGetDossier = dossierLib.getDossierForText as MockedFunction<typeof dossierLib.getDossierForText>;
const mockGetSystemPrompt = prompt.getSystemPrompt as MockedFunction<typeof prompt.getSystemPrompt>;
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
  preferredVoice: 'scholar' as const,
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
const { GET: hierarchyGET } = await import('@/app/api/hierarchy/route');

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
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockOne.mockResolvedValueOnce({ id: 's2', title: 'New session', created_at: '', updated_at: '' });

    const res = await sessionsPOST(req('POST', '/api/sessions', { title: 'New session' }));
    expect(res.status).toBe(201);
  });

  it('snapshots pro user preferredVoice=woowoo onto the new session', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredVoice: 'woowoo' });
    mockOne.mockResolvedValueOnce({ id: 's3', title: null, created_at: '', updated_at: '' });

    const res = await sessionsPOST(req('POST', '/api/sessions', {}));
    expect(res.status).toBe(201);
    const [insertSql, insertParams] = mockOne.mock.calls[0]!;
    expect(insertSql).toMatch(/INSERT INTO sessions/i);
    expect(insertSql).toMatch(/voice/);
    expect(insertParams![2]).toBe('woowoo');
  });

  it('free user with preferredVoice=woowoo still snapshots scholar (pro gate)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredVoice: 'woowoo' });
    mockOne.mockResolvedValueOnce({ id: 's4', title: null, created_at: '', updated_at: '' });

    await sessionsPOST(req('POST', '/api/sessions', {}));
    const [, insertParams] = mockOne.mock.calls[0]!;
    expect(insertParams![2]).toBe('scholar');
  });

  // Study mode (migration 014, summary-phase-w.md §W2)

  it('400s a study session without study_text_id', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    const res = await sessionsPOST(req('POST', '/api/sessions', { mode: 'study' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/study_text_id/);
  });

  it('400s a study session whose text id is not in corpus.texts', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce(null); // texts lookup misses
    const res = await sessionsPOST(
      req('POST', '/api/sessions', { mode: 'study', study_text_id: 'no-such-text' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown text id/);
  });

  it('creates a study session pinned to a valid text', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockOne
      .mockResolvedValueOnce({ id: 'gnostic-john-baptizer-2' }) // texts lookup hits
      .mockResolvedValueOnce({
        id: 's5', title: null, mode: 'study', study_text_id: 'gnostic-john-baptizer-2',
        created_at: '', updated_at: '',
      });
    const res = await sessionsPOST(
      req('POST', '/api/sessions', { mode: 'study', study_text_id: 'gnostic-john-baptizer-2' }));
    expect(res.status).toBe(201);
    const [insertSql, insertParams] = mockOne.mock.calls[1]!;
    expect(insertSql).toMatch(/mode, study_text_id/);
    expect(insertParams![3]).toBe('study');
    expect(insertParams![4]).toBe('gnostic-john-baptizer-2');
  });

  it("400s an unknown mode value", async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    const res = await sessionsPOST(req('POST', '/api/sessions', { mode: 'zen' }));
    expect(res.status).toBe(400);
  });

  it('400s a stray study_text_id on chat sessions (client bug surfaced at the write boundary)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    const res = await sessionsPOST(req('POST', '/api/sessions', { study_text_id: 'kalevala' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/requires mode/);
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
    expect(body.preferredVoice).toBe('scholar');
  });

  it('returns preferredVoice from storage', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredVoice: 'woowoo' });

    const res = await prefsGET();
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(body.preferredVoice).toBe('woowoo');
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

// ── preferredVoice validation + pro gate (BRD-chat-voice §6, IMPL §6, todo:e66c39c9) ──
describe('PUT /api/preferences — preferredVoice', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('pro user can write preferredVoice=woowoo', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockSavePrefs.mockResolvedValueOnce(undefined);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredVoice: 'woowoo' }));
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(res.status).toBe(200);
    expect(body.preferredVoice).toBe('woowoo');
    const [, savedPrefs] = mockSavePrefs.mock.calls[0]!;
    expect(savedPrefs.preferredVoice).toBe('woowoo');
  });

  it('pro user can write preferredVoice=scholar (revert to default)', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredVoice: 'woowoo' });
    mockSavePrefs.mockResolvedValueOnce(undefined);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredVoice: 'scholar' }));
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(res.status).toBe(200);
    expect(body.preferredVoice).toBe('scholar');
  });

  it('free user may write preferredVoice=scholar (no-op write allowed)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockSavePrefs.mockResolvedValueOnce(undefined);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredVoice: 'scholar' }));
    expect(res.status).toBe(200);
  });

  it('free user attempting preferredVoice=woowoo is rejected with 403', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredVoice: 'woowoo' }));
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Pro/i);
    expect(mockSavePrefs).not.toHaveBeenCalled();
  });

  it('rejects unknown voice slug with 400 for any tier', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredVoice: 'sage-of-atlantis' }));
    expect(res.status).toBe(400);
    expect(mockSavePrefs).not.toHaveBeenCalled();
  });

  it('rejects null preferredVoice with 400 (not a known slug)', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);

    const res = await prefsPUT(req('PUT', '/api/preferences', { preferredVoice: null }));
    expect(res.status).toBe(400);
    expect(mockSavePrefs).not.toHaveBeenCalled();
  });

  it('keeps existing preferredVoice when field absent from body', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredVoice: 'woowoo' });
    mockSavePrefs.mockResolvedValueOnce(undefined);

    const res = await prefsPUT(req('PUT', '/api/preferences', { scopeMode: 'all' }));
    const body = await res.json() as typeof DEFAULT_PREFS;
    expect(body.preferredVoice).toBe('woowoo');
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

  it('aggregates DISTINCT (tradition, text_id, text_name) chunk rows into the catalog shape', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockQuery
      .mockResolvedValueOnce([
        { tradition: 'Gnosticism', text_id: 'gospel-of-thomas', text_name: 'Gospel of Thomas' },
        { tradition: 'Gnosticism', text_id: 'gospel-of-philip', text_name: 'Gospel of Philip' },
        // grouped-work members share a display label — must dedupe (review finding)
        { tradition: 'Taoism',     text_id: 'tao-te-ching-legge', text_name: 'Tao Te Ching' },
        { tradition: 'Taoism',     text_id: 'tao-te-ching-2', text_name: 'Tao Te Ching' },
      ])
      .mockResolvedValueOnce([
        { id: 'gospel-of-thomas', label: 'Gospel of Thomas', tradition: 'Gnosticism',
          member_text_ids: ['gospel-of-thomas'] },
        { id: 'tao-te-ching-legge', label: 'Tao Te Ching', tradition: 'Taoism',
          member_text_ids: ['tao-te-ching-legge', 'tao-te-ching-2'] },
      ]);

    const res = await corpusGET();
    const body = await res.json() as {
      traditions: Record<string, { texts: string[]; text_items: { id: string; label: string }[] }>;
      works: { id: string; label: string; tradition: string; members: number; pin_text_id: string }[];
    };
    expect(res.status).toBe(200);
    // duplicate member labels collapse to one catalog entry
    expect(body.traditions.Taoism.texts).toEqual(['Tao Te Ching']);
    // works array drives the study picker: one entry per WORK with a pin id
    expect(body.works).toEqual([
      { id: 'gospel-of-thomas', label: 'Gospel of Thomas', tradition: 'Gnosticism', members: 1, pin_text_id: 'gospel-of-thomas' },
      { id: 'tao-te-ching-legge', label: 'Tao Te Ching', tradition: 'Taoism', members: 2, pin_text_id: 'tao-te-ching-legge' },
    ]);
    expect(body.traditions).toEqual({
      Gnosticism: {
        texts: ['Gospel of Thomas', 'Gospel of Philip'],
        text_items: [
          { id: 'gospel-of-thomas', label: 'Gospel of Thomas' },
          { id: 'gospel-of-philip', label: 'Gospel of Philip' },
        ],
      },
      Taoism: {
        texts: ['Tao Te Ching'],
        text_items: [{ id: 'tao-te-ching-legge', label: 'Tao Te Ching' }],
      },
    });

    const [sql] = mockQuery.mock.calls[0]!;
    expect(sql).toMatch(/SELECT\s+DISTINCT\s+tradition,\s*text_id,\s*text_name\s+FROM\s+chunks/i);
  });

  it('returns an empty catalog when chunks is empty (no fallback)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

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
    // Default: no prior turns — loadSessionHistory reads via db.query.
    // Multi-turn tests override per-test.
    mockQuery.mockResolvedValue([]);
    // Default: query didn't expand (no transparency header). The expansion test
    // overrides this.
    mockSummarize.mockResolvedValue([]);
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

  // Study sessions (summary-phase-w.md §W5): the route must switch to the
  // W3 retrieval signature and the W4 prompt builder. Modeled on the 429
  // tests — reserveBudget denies AFTER retrieval+prompt, so the assertion
  // surface is reached without streaming.
  it('study session uses study retrieval + dossier prompt', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({
      id: 's9', voice: 'scholar', mode: 'study', study_text_id: 'plato-republic-7-0',
    });
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    const dossierFixture = { work_id: 'plato-republic', work_label: 'Plato: Republic' };
    mockGetDossier.mockResolvedValueOnce(dossierFixture as never);
    mockBuildStudy.mockReturnValueOnce('study prompt');
    mockComputeCost.mockResolvedValueOnce(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce({
      allowed: false, reason: 'queries',
      queries_used: 10, usd_used: 0, query_limit: 10, usd_limit: null,
    });

    const res = await queryPOST(req('POST', '/api/query', { query: 'the cave', sessionId: 's9' }));
    expect(res.status).toBe(429); // deliberate stop after the assertion surface

    expect(mockRetrieve).toHaveBeenCalledWith('the cave', DEFAULT_PREFS, 15, 'study', 'plato-republic-7-0');
    expect(mockGetDossier).toHaveBeenCalledWith('plato-republic-7-0');
    expect(mockBuildStudy).toHaveBeenCalledWith('the cave', [], dossierFixture, DEFAULT_PREFS, 'free', 0);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it('chat session never touches the dossier or study prompt', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1', voice: 'scholar', mode: 'chat', study_text_id: null });
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('prompt');
    mockComputeCost.mockResolvedValueOnce(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce({
      allowed: false, reason: 'queries',
      queries_used: 10, usd_used: 0, query_limit: 10, usd_limit: null,
    });

    await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
    expect(mockRetrieve).toHaveBeenCalledWith('q', DEFAULT_PREFS);
    expect(mockGetDossier).not.toHaveBeenCalled();
    expect(mockBuildStudy).not.toHaveBeenCalled();
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

  it('surfaces query expansion in the X-Query-Expansion header when a family/domain matched (todo:9d2ad427)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);
    mockSummarize.mockResolvedValueOnce([{ tier: 'domain', label: 'Cosmology', conceptCount: 7 }]);

    async function* fakeStream() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(fakeStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'cosmology', sessionId: 's1' }));
    expect(res.status).toBe(200);
    const header = res.headers.get('X-Query-Expansion');
    expect(header).toBeTruthy();
    expect(JSON.parse(decodeURIComponent(header!))).toEqual([
      { tier: 'domain', label: 'Cosmology', conceptCount: 7 },
    ]);
    await res.text(); // drain the stream
  });

  it('omits the X-Query-Expansion header when nothing expanded', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);
    // mockSummarize defaults to [] (beforeEach)

    async function* fakeStream() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(fakeStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'qqq', sessionId: 's1' }));
    expect(res.headers.get('X-Query-Expansion')).toBeNull();
    await res.text();
  });

  it('surfaces retrieved chunks as authoritative citations in the X-Citations header (todo:2fd21c61)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    // Two retrieved chunks — the chat client renders these as live "References"
    // cards instead of parsing the model's free-text CITATIONS tail.
    mockRetrieve.mockResolvedValueOnce([
      { id: 'c1', text_id: 't1', tradition: 'neoplatonism', text_name: 'Enneads', section: 'V.1', translator: null, body: 'b', token_count: 1, source: 'vector', tier: 'verified' },
      { id: 'c2', text_id: 't2', tradition: 'taoism', text_name: 'Tao Te Ching', section: '1', translator: null, body: 'b', token_count: 1, source: 'graph', tier: 'proposed' },
    ] as never);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);

    async function* fakeStream() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(fakeStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'the One', sessionId: 's1' }));
    expect(res.status).toBe(200);
    const header = res.headers.get('X-Citations');
    expect(header).toBeTruthy();
    expect(JSON.parse(decodeURIComponent(header!))).toEqual([
      { tradition: 'neoplatonism', text: 'Enneads', section: 'V.1', tier: 'verified' },
      { tradition: 'taoism', text: 'Tao Te Ching', section: '1', tier: 'proposed' },
    ]);
    await res.text();
  });

  it('omits the X-Citations header when retrieval returned no chunks', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);

    async function* fakeStream() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(fakeStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'qqq', sessionId: 's1' }));
    expect(res.headers.get('X-Citations')).toBeNull();
    await res.text();
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

  it('drains to completion server-side when client cancels mid-stream (todo:38fb34db)', async () => {
    // ChatGPT-style expectation: navigating away must not cancel generation.
    // When the consumer cancels, the next controller.enqueue() throws
    // "Controller is already closed" — but instead of breaking the loop
    // (which would .return() the upstream iterator and abort the provider
    // fetch), we stop enqueuing and KEEP draining. The stream runs to its
    // natural end, the final usage chunk arrives, and the FULL response +
    // real token counts get persisted and billed — not the partial.

    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);

    // Slow stream so we can cancel between chunks; the loop body then
    // re-enters enqueue against a now-closed controller. A final usage chunk
    // lands after all content, exactly as a real provider stream would.
    async function* slowStream() {
      for (let i = 0; i < 5; i++) {
        yield { choices: [{ delta: { content: `c${i} ` } }] };
        await new Promise(r => setTimeout(r, 5));
      }
      yield { choices: [], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } };
    }
    mockStream.mockResolvedValueOnce(slowStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));

    // Read first chunk, then cancel — simulates client disconnect.
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    // Give start() time to drain the rest of the stream + persist.
    await new Promise(r => setTimeout(r, 100));

    expect(mockExec).toHaveBeenCalledTimes(1);
    const [, params] = mockExec.mock.calls[0]!;
    // Full response persisted, not just the chunk the client received.
    expect(params![3]).toBe('c0 c1 c2 c3 c4 ');
    // Usage captured from the final chunk despite the client being gone.
    expect(params![7]).toBe(42);  // input_tokens
    expect(params![8]).toBe(7);   // output_tokens
    // Cost reconciled normally — abandoned queries bill like any other.
    expect(mockFinalizeBudget).toHaveBeenCalled();
  });

  // ── Multi-turn conversation continuity (BRD-conversation-continuity §4.5) ──

  it('threads prior turns into the messages array when sessionId has history', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    // loadSessionHistory: one prior user/assistant pair.
    mockQuery.mockResolvedValueOnce([
      { query_text: 'prior q', response_text: 'prior a' },
    ]);
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('new turn prompt');
    mockExec.mockResolvedValue(undefined);
    async function* s() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(s() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'follow-up', sessionId: 's1' }));
    await res.text();

    const [messages] = mockStream.mock.calls[0]!;
    expect(messages).toEqual([
      { role: 'system',    content: 'mock system prompt' },
      { role: 'user',      content: 'prior q' },
      { role: 'assistant', content: 'prior a' },
      { role: 'user',      content: 'new turn prompt' },
    ]);
  });

  it('sends a 2-message array when no sessionId (auto-create path)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    // No ownership lookup expected; the mock for `one` is still used by
    // the auto-create insert. Returning {id:'new'} satisfies that path.
    mockOne.mockResolvedValueOnce({ id: 'auto-created' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('first prompt');
    mockExec.mockResolvedValue(undefined);
    async function* s() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(s() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'first turn' }));
    await res.text();

    const [messages] = mockStream.mock.calls[0]!;
    expect(messages).toEqual([
      { role: 'system', content: 'mock system prompt' },
      { role: 'user',   content: 'first prompt' },
    ]);
    // loadSessionHistory should not have been called when sessionId is absent.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('skips errored prior turns (empty response_text) when threading history', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockOne.mockResolvedValueOnce({ id: 's1' });
    mockQuery.mockResolvedValueOnce([
      { query_text: 'good q',    response_text: 'good a' },
      { query_text: 'errored q', response_text: '' },     // streamed, then aborted
    ]);
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('next prompt');
    mockExec.mockResolvedValue(undefined);
    async function* s() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(s() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
    await res.text();

    const [messages] = mockStream.mock.calls[0]!;
    expect(messages).toEqual([
      { role: 'system',    content: 'mock system prompt' },
      { role: 'user',      content: 'good q' },
      { role: 'assistant', content: 'good a' },
      { role: 'user',      content: 'next prompt' },
    ]);
  });

  it('reservation estimate grows when history is present', async () => {
    // Two runs of the same shape, distinguished only by whether prior turns
    // exist — assert computeCost sees a larger inputTokens count in the
    // history case.
    async function runOnce(history: { query_text: string; response_text: string }[]) {
      mockAuth.mockResolvedValueOnce(FREE_USER);
      mockOne.mockResolvedValueOnce({ id: 's1' });
      mockQuery.mockResolvedValueOnce(history);
      mockComputeCost.mockResolvedValueOnce(DEFAULT_COST);   // estimate
      mockComputeCost.mockResolvedValueOnce(DEFAULT_COST);   // actual (post-stream)
      mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
      mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
      mockRetrieve.mockResolvedValueOnce([]);
      mockBuild.mockReturnValueOnce('p');
      mockExec.mockResolvedValue(undefined);
      async function* s() { yield { choices: [{ delta: { content: 'ok' } }] }; }
      mockStream.mockResolvedValueOnce(s() as never);
      const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
      await res.text();
    }

    // Without history.
    await runOnce([]);
    const tokensWithoutHistory = (mockComputeCost.mock.calls[0]![0] as { inputTokens: number }).inputTokens;

    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({ allowed: true });
    mockQuery.mockResolvedValue([]);

    // With ~400 chars of history (~100 tokens at 4 chars/token).
    const big = 'x'.repeat(200);
    await runOnce([{ query_text: big, response_text: big }]);
    const tokensWithHistory = (mockComputeCost.mock.calls[0]![0] as { inputTokens: number }).inputTokens;

    expect(tokensWithHistory).toBeGreaterThan(tokensWithoutHistory);
    expect(tokensWithHistory - tokensWithoutHistory).toBeGreaterThanOrEqual(100);
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
    mockQuery.mockResolvedValue([]);   // loadSessionHistory: no prior turns
    mockSummarize.mockResolvedValue([]);
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
    const [messages, modelId, slug] = mockStream.mock.calls[0]!;
    expect(messages).toEqual([
      { role: 'system', content: 'mock system prompt' },
      { role: 'user',   content: 'p' },
    ]);
    expect(modelId).toBe('anthropic/claude-sonnet-4.6');
    expect(slug).toBe('anthropic');
    const [, persistParams] = mockExec.mock.calls[0]!;
    expect(persistParams![5]).toBe('anthropic/claude-sonnet-4.6');
  });

  it('pro user with preferredModel=null falls through to deepseek default', async () => {
    await runQueryWithPrefs(PRO_USER, null);
    const [, modelId, slug] = mockStream.mock.calls[0]!;
    expect(modelId).toBe('deepseek/deepseek-v4-pro');
    expect(slug).toBe('deepseek');
    const [, persistParams] = mockExec.mock.calls[0]!;
    expect(persistParams![5]).toBe('deepseek/deepseek-v4-pro');
  });

  it('free user with any preferredModel value still resolves to default', async () => {
    await runQueryWithPrefs(FREE_USER, 'anthropic');
    const [, modelId, slug] = mockStream.mock.calls[0]!;
    expect(modelId).toBe('deepseek/deepseek-v4-pro');
    expect(slug).toBe('deepseek');
  });

  it('pro user with stale/unknown slug (post-rename) falls through to default', async () => {
    await runQueryWithPrefs(PRO_USER, 'old-removed-slug');
    const [, modelId, slug] = mockStream.mock.calls[0]!;
    expect(modelId).toBe('deepseek/deepseek-v4-pro');
    expect(slug).toBe('deepseek');
  });
});

// ---------------------------------------------------------------------------
// Voice resolution (BRD-chat-voice §5, IMPL §5, todo:2f14b5d6)
// ---------------------------------------------------------------------------
// Two distinct paths:
//   (a) Auto-create (no sessionId): the route snapshots the resolved
//       voice onto the new sessions.voice row, gated by tier.
//   (b) Existing session: the route reads sessions.voice from the
//       ownership SELECT and passes it to getSystemPrompt regardless
//       of the user's *current* profile voice. Thread coherence wins.

describe('POST /api/query — voice resolution (auto-create path)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRateLimit.mockResolvedValue({ allowed: true });
    mockQuery.mockResolvedValue([]);
    mockSummarize.mockResolvedValue([]);
  });

  async function runAutoCreate(
    user: typeof FREE_USER | typeof PRO_USER,
    preferredVoice: 'scholar' | 'woowoo',
  ) {
    mockAuth.mockResolvedValueOnce(user);
    // No ownership SELECT (no sessionId). The INSERT INTO sessions is
    // the first (and only) `one` call.
    mockOne.mockResolvedValueOnce({ id: 'new-session' });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredVoice });
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('p');
    mockExec.mockResolvedValue(undefined);
    async function* s() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(s() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q' }));
    await res.text();
  }

  it('pro user with preferredVoice=woowoo snapshots woowoo onto the new session', async () => {
    await runAutoCreate(PRO_USER, 'woowoo');
    expect(mockGetSystemPrompt).toHaveBeenCalledWith('woowoo');
    const [insertSql, insertParams] = mockOne.mock.calls[0]!;
    expect(insertSql).toMatch(/INSERT INTO sessions/i);
    expect(insertSql).toMatch(/voice/);
    expect(insertParams).toEqual(['user_2', 'q', 'woowoo']);
  });

  it('pro user with preferredVoice=scholar snapshots scholar', async () => {
    await runAutoCreate(PRO_USER, 'scholar');
    expect(mockGetSystemPrompt).toHaveBeenCalledWith('scholar');
    const [, insertParams] = mockOne.mock.calls[0]!;
    expect(insertParams![2]).toBe('scholar');
  });

  it('free user with preferredVoice=woowoo still snapshots scholar (pro gate)', async () => {
    await runAutoCreate(FREE_USER, 'woowoo');
    expect(mockGetSystemPrompt).toHaveBeenCalledWith('scholar');
    const [, insertParams] = mockOne.mock.calls[0]!;
    expect(insertParams![2]).toBe('scholar');
  });
});

describe('POST /api/query — voice resolution (existing session path)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRateLimit.mockResolvedValue({ allowed: true });
    mockQuery.mockResolvedValue([]);
    mockSummarize.mockResolvedValue([]);
  });

  async function runWithSession(
    user: typeof FREE_USER | typeof PRO_USER,
    sessionVoice: string,
    preferredVoice: 'scholar' | 'woowoo' = 'scholar',
  ) {
    mockAuth.mockResolvedValueOnce(user);
    // Ownership SELECT returns the session row including its voice.
    mockOne.mockResolvedValueOnce({ id: 's1', voice: sessionVoice });
    mockComputeCost.mockResolvedValue(DEFAULT_COST);
    mockReserveBudget.mockResolvedValueOnce(ALLOWED_RESERVE);
    mockPrefs.mockResolvedValueOnce({ ...DEFAULT_PREFS, preferredVoice });
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('p');
    mockExec.mockResolvedValue(undefined);
    async function* s() { yield { choices: [{ delta: { content: 'ok' } }] }; }
    mockStream.mockResolvedValueOnce(s() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'q', sessionId: 's1' }));
    await res.text();
  }

  it('uses the session-snapshotted voice over the current profile pref', async () => {
    // Profile says scholar; session says woowoo. Session wins.
    await runWithSession(PRO_USER, 'woowoo', 'scholar');
    expect(mockGetSystemPrompt).toHaveBeenCalledWith('woowoo');
  });

  it('honors session.voice=scholar even when profile is now woowoo', async () => {
    await runWithSession(PRO_USER, 'scholar', 'woowoo');
    expect(mockGetSystemPrompt).toHaveBeenCalledWith('scholar');
  });

  it('preserves an old woowoo session for a now-downgraded free user', async () => {
    // Thread coherence: the prior turns were generated under woowoo,
    // continuing under scholar would mix registers within the thread.
    await runWithSession(FREE_USER, 'woowoo', 'scholar');
    expect(mockGetSystemPrompt).toHaveBeenCalledWith('woowoo');
  });

  it('falls back to DEFAULT_VOICE when storage somehow has an unknown slug', async () => {
    // Defensive: should never happen given the migration default, but
    // shouldn't crash getSystemPrompt() if it does.
    await runWithSession(PRO_USER, 'sage-of-atlantis', 'scholar');
    expect(mockGetSystemPrompt).toHaveBeenCalledWith('scholar');
  });
});

// ---------------------------------------------------------------------------
// /api/hierarchy (todo:60bd563f)
// ---------------------------------------------------------------------------

describe('GET /api/hierarchy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 if not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await hierarchyGET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('assembles a domain → family → concept tree from the real tables', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    // 1st query: families (domains have parent_id null). 2nd: concepts.
    mockQuery.mockResolvedValueOnce([
      { id: 'metaphysics', parent_id: null, label: 'Metaphysics', definition: 'd1' },
      { id: 'metaphysics.first_principles', parent_id: 'metaphysics', label: 'First Principles', definition: 'd2' },
    ]);
    mockQuery.mockResolvedValueOnce([
      { id: 'atman', label: 'Atman', definition: 'a', family_id: 'metaphysics.first_principles' },
      { id: 'nous', label: 'Nous', definition: 'n', family_id: 'metaphysics.first_principles' },
    ]);

    const res = await hierarchyGET();
    const body = await res.json() as { domains: Array<{ id: string; families: Array<{ id: string; concepts: Array<{ id: string }> }> }> };
    expect(res.status).toBe(200);
    expect(body.domains).toHaveLength(1);
    expect(body.domains[0].id).toBe('metaphysics');
    expect(body.domains[0].families).toHaveLength(1);
    expect(body.domains[0].families[0].id).toBe('metaphysics.first_principles');
    expect(body.domains[0].families[0].concepts.map(c => c.id)).toEqual(['atman', 'nous']);
  });

  it('returns an empty tree when the hierarchy tables are empty (no fallback)', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockQuery.mockResolvedValueOnce([]); // families
    mockQuery.mockResolvedValueOnce([]); // concepts

    const res = await hierarchyGET();
    const body = await res.json() as { domains: unknown[] };
    expect(res.status).toBe(200);
    expect(body.domains).toEqual([]);
  });
});
