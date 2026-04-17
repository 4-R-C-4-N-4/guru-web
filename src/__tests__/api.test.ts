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

vi.mock('@/lib/quota', () => ({
  checkAndIncrement: vi.fn(),
}));

vi.mock('@/lib/retriever', () => ({
  retrieve: vi.fn(),
}));

vi.mock('@/lib/prompt', () => ({
  buildPrompt: vi.fn(),
}));

vi.mock('@/lib/model', () => ({
  completeStream: vi.fn(),
  MODELS: { free: 'deepseek/deepseek-chat', pro: 'anthropic/claude-sonnet-4-5' },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as db      from '@/lib/db';
import * as auth    from '@/lib/auth';
import * as prefs   from '@/lib/prefs';
import * as quota   from '@/lib/quota';
import * as retriever from '@/lib/retriever';
import * as prompt  from '@/lib/prompt';
import * as model   from '@/lib/model';

const mockQuery  = db.query      as MockedFunction<typeof db.query>;
const mockOne    = db.one        as MockedFunction<typeof db.one>;
const mockExec   = db.exec       as MockedFunction<typeof db.exec>;
const mockAuth   = auth.requireUser       as MockedFunction<typeof auth.requireUser>;
const mockPrefs  = prefs.loadPreferences  as MockedFunction<typeof prefs.loadPreferences>;
const mockSavePrefs = prefs.savePreferences as MockedFunction<typeof prefs.savePreferences>;
const mockQuota  = quota.checkAndIncrement as MockedFunction<typeof quota.checkAndIncrement>;
const mockRetrieve = retriever.retrieve   as MockedFunction<typeof retriever.retrieve>;
const mockBuild  = prompt.buildPrompt     as MockedFunction<typeof prompt.buildPrompt>;
const mockStream = model.completeStream   as MockedFunction<typeof model.completeStream>;

const FREE_USER = { id: 'user_1', email: 'a@b.com', tier: 'free' as const, stripe_customer_id: null };
const DEFAULT_PREFS = { scopeMode: 'all' as const, blockedTraditions: [], blockedTexts: [], whitelistedTraditions: [], whitelistedTexts: [] };

// ---------------------------------------------------------------------------
// /api/sessions
// ---------------------------------------------------------------------------

const { GET: sessionsGET, POST: sessionsPOST } = await import('@/app/api/sessions/route');
const { GET: sessionGET } = await import('@/app/api/sessions/[id]/route');
const { GET: prefsGET, PUT: prefsPUT } = await import('@/app/api/preferences/route');
const { POST: queryPOST } = await import('@/app/api/query/route');

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

describe('POST /api/query', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 429 when quota exceeded', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockQuota.mockResolvedValueOnce({ allowed: false, used: 31, limit: 30 });

    const res = await queryPOST(req('POST', '/api/query', { query: 'test', sessionId: 's1' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for missing query', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);

    const res = await queryPOST(req('POST', '/api/query', {}));
    expect(res.status).toBe(400);
  });

  it('streams response when quota allows', async () => {
    mockAuth.mockResolvedValueOnce(FREE_USER);
    mockQuota.mockResolvedValueOnce({ allowed: true, used: 1, limit: 30 });
    mockPrefs.mockResolvedValueOnce(DEFAULT_PREFS);
    mockRetrieve.mockResolvedValueOnce([]);
    mockBuild.mockReturnValueOnce('assembled prompt');
    mockExec.mockResolvedValue(undefined);

    // Simulate an async iterable stream
    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'Hello ' } }] };
      yield { choices: [{ delta: { content: 'world' } }] };
    }
    mockStream.mockResolvedValueOnce(fakeStream() as never);

    const res = await queryPOST(req('POST', '/api/query', { query: 'What is gnosis?', sessionId: 's1' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Quota-Used')).toBe('1');

    // Read the streamed body
    const text = await res.text();
    expect(text).toBe('Hello world');
  });
});
