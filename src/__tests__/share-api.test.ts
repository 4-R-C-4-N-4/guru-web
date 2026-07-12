/**
 * src/__tests__/share-api.test.ts
 *
 * Unit tests for POST/DELETE /api/sessions/[id]/share (todo:131dbb82).
 * db, auth, prefs and the citation rehydrator are mocked — assertion
 * surface is the SQL + params the route emits and the snapshot shape it
 * persists.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

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
}));

vi.mock('@/lib/corpus', () => ({
  rehydrateCitations: vi.fn(),
}));

import * as db from '@/lib/db';
import * as auth from '@/lib/auth';
import * as prefs from '@/lib/prefs';
import * as corpus from '@/lib/corpus';

const mockOne       = db.one                  as MockedFunction<typeof db.one>;
const mockQuery     = db.query                as MockedFunction<typeof db.query>;
const mockAuth      = auth.requireUser        as MockedFunction<typeof auth.requireUser>;
const mockPrefs     = prefs.loadPreferences   as MockedFunction<typeof prefs.loadPreferences>;
const mockRehydrate = corpus.rehydrateCitations as MockedFunction<typeof corpus.rehydrateCitations>;

const { POST: sharePOST, DELETE: shareDELETE } = await import('@/app/api/sessions/[id]/share/route');

const USER = { id: 'user_1', email: 'a@b.com', tier: 'free' as const, stripe_customer_id: null, payment_state: null };
const PREFS = {
  scopeMode: 'blacklist' as const,
  blockedTraditions: ['hermeticism'], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [],
  preferredModel: 'anthropic',
  preferredVoice: 'woowoo' as const,
};
const SESSION_ROW = { id: 's1', voice: 'woowoo', mode: 'chat' as const, study_text_id: null };

function req(method: string) {
  return new Request('http://test/api/sessions/s1/share', { method });
}
const ctx = { params: Promise.resolve({ id: 's1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(USER);
});

describe('POST /api/sessions/[id]/share', () => {
  it('404s when the session belongs to another user, with user_id in the predicate', async () => {
    mockOne.mockResolvedValueOnce(null); // ownership SELECT misses

    const res = await sharePOST(req('POST'), ctx);
    expect(res.status).toBe(404);

    const [sql, sqlParams] = mockOne.mock.calls[0]!;
    expect(sql).toMatch(/user_id = \$2/);
    expect(sqlParams).toEqual(['s1', 'user_1']);
  });

  it('returns the existing active share instead of minting a second slug', async () => {
    mockOne
      .mockResolvedValueOnce(SESSION_ROW)                                // ownership
      .mockResolvedValueOnce({ slug: 'existing-slug', created_at: 't' }); // active share

    const res = await sharePOST(req('POST'), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ slug: 'existing-slug', url: '/share/existing-slug', reused: true });
    expect(mockOne).toHaveBeenCalledTimes(2); // no INSERT
    expect(mockQuery).not.toHaveBeenCalled();  // records never loaded
  });

  it('400s on a session with no turns', async () => {
    mockOne
      .mockResolvedValueOnce(SESSION_ROW)
      .mockResolvedValueOnce(null); // no active share
    mockQuery.mockResolvedValueOnce([]); // zero queries rows

    const res = await sharePOST(req('POST'), ctx);
    expect(res.status).toBe(400);
  });

  it('persists a self-contained snapshot: rich citations, session settings, frozen scope', async () => {
    mockOne
      .mockResolvedValueOnce(SESSION_ROW)
      .mockResolvedValueOnce(null); // no active share
    mockQuery.mockResolvedValueOnce([
      { query_text: 'q1', response_text: 'r1', chunks_used: ['c1', 'stale'], created_at: 't1' },
      { query_text: 'q2', response_text: 'r2', chunks_used: null, created_at: 't2' },
    ]);
    // 'stale' is gone from the corpus — must drop out of the snapshot.
    mockRehydrate.mockResolvedValueOnce(new Map([
      ['c1', { id: 'c1', tradition: 'gnosticism', text: 'Gospel of Thomas', section: '§22', tier: 'verified' as const }],
    ]));
    mockPrefs.mockResolvedValueOnce(PREFS);
    mockOne.mockResolvedValueOnce({ slug: 'fresh-slug', created_at: 't3' }); // INSERT RETURNING

    const res = await sharePOST(req('POST'), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({ slug: 'fresh-slug', url: '/share/fresh-slug', reused: false });

    const [insertSql, insertParams] = mockOne.mock.calls[2]!;
    expect(insertSql).toMatch(/INSERT INTO session_shares/);
    const [slug, sessionId, userId, messagesJson, voice, mode, studyTextId, scopeJson] = insertParams as string[];
    expect(slug).toMatch(/^[A-Za-z0-9_-]{20,24}$/); // 16 bytes base64url, unguessable
    expect(sessionId).toBe('s1');
    expect(userId).toBe('user_1');
    expect(voice).toBe('woowoo');
    expect(mode).toBe('chat');
    expect(studyTextId).toBeNull();

    const messages = JSON.parse(messagesJson);
    expect(messages).toHaveLength(2);
    expect(messages[0].citations).toEqual([
      { id: 'c1', tradition: 'gnosticism', text: 'Gospel of Thomas', section: '§22', tier: 'verified' },
    ]);
    expect(messages[1].citations).toEqual([]);

    // Scope fields only — preferredModel/preferredVoice must NOT leak into
    // the frozen scope (they stay live on the forker's side).
    expect(JSON.parse(scopeJson)).toEqual({
      scopeMode: 'blacklist',
      blockedTraditions: ['hermeticism'], blockedTexts: [],
      whitelistedTraditions: [], whitelistedTexts: [],
    });
  });

  it('retries with a fresh slug on a 23505 unique collision', async () => {
    mockOne
      .mockResolvedValueOnce(SESSION_ROW)
      .mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce([
      { query_text: 'q', response_text: 'r', chunks_used: null, created_at: 't' },
    ]);
    mockRehydrate.mockResolvedValueOnce(new Map());
    mockPrefs.mockResolvedValueOnce(PREFS);
    mockOne
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
      .mockResolvedValueOnce({ slug: 'second-try', created_at: 't' });

    const res = await sharePOST(req('POST'), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.slug).toBe('second-try');
    const slug1 = (mockOne.mock.calls[2]![1] as string[])[0];
    const slug2 = (mockOne.mock.calls[3]![1] as string[])[0];
    expect(slug1).not.toBe(slug2);
  });
});

describe('DELETE /api/sessions/[id]/share', () => {
  it('revokes the active share scoped to the owner', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'share_1' }]);

    const res = await shareDELETE(req('DELETE'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });

    const [sql, sqlParams] = mockQuery.mock.calls[0]!;
    expect(sql).toMatch(/SET revoked_at = now\(\)/);
    expect(sql).toMatch(/user_id = \$2/);
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(sqlParams).toEqual(['s1', 'user_1']);
  });

  it('404s when there is no active share', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await shareDELETE(req('DELETE'), ctx);
    expect(res.status).toBe(404);
  });
});
