/**
 * src/__tests__/share-fork.test.ts
 *
 * POST /api/shares/[slug]/fork (todo:e13dd999): the fork must copy the
 * snapshot's settings onto the new session (voice grandfathered — no tier
 * re-check), freeze the scope into scope_override, and persist the copied
 * turns with ZEROED accounting (backfill-cost-safe) and bare chunk ids.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ one: vi.fn(), query: vi.fn(), exec: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/chat-public', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat-public')>('@/lib/chat-public');
  return { ...actual, getShareBySlug: vi.fn() };
});

import * as db from '@/lib/db';
import * as auth from '@/lib/auth';
import * as chatPublic from '@/lib/chat-public';
import type { PublicShare } from '@/lib/chat-public';

const mockOne      = db.one                   as MockedFunction<typeof db.one>;
const mockExec     = db.exec                  as MockedFunction<typeof db.exec>;
const mockAuth     = auth.requireUser         as MockedFunction<typeof auth.requireUser>;
const mockGetShare = chatPublic.getShareBySlug as MockedFunction<typeof chatPublic.getShareBySlug>;

const { POST: forkPOST } = await import('@/app/api/shares/[slug]/fork/route');

// A FREE-tier forker forking a share made under the pro 'woowoo' voice and
// a custom scope — the settings must copy anyway (grandfathered).
const FREE_FORKER = { id: 'visitor_1', email: 'v@b.com', tier: 'free' as const, stripe_customer_id: null, payment_state: null };

const SHARE: PublicShare = {
  id: 'share_1',
  slug: 'abc',
  title: 'On the Demiurge',
  voice: 'woowoo',
  mode: 'study',
  study_text_id: 'plato-republic-7-0',
  retrieval_scope: {
    scopeMode: 'whitelist',
    blockedTraditions: [], blockedTexts: [],
    whitelistedTraditions: ['gnosticism'], whitelistedTexts: [],
  },
  created_at: '2026-07-11T00:00:00Z',
  messages: [
    {
      query_text: 'q1', response_text: 'r1', created_at: 't1',
      citations: [
        { id: 'c1', tradition: 'gnosticism', text: 'Gospel of Philip', section: '78', tier: 'verified' },
        { id: 'c2', tradition: 'gnosticism', text: 'Gospel of Thomas', section: '22', tier: 'verified' },
      ],
    },
    { query_text: 'q2', response_text: 'r2', created_at: 't2', citations: [] },
  ],
};

const ctx = { params: Promise.resolve({ slug: 'abc' }) };
const req = () => new Request('http://test/api/shares/abc/fork', { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(FREE_FORKER);
});

describe('POST /api/shares/[slug]/fork', () => {
  it('404s on unknown or revoked shares (the helper filters revoked)', async () => {
    mockGetShare.mockResolvedValueOnce(null);
    const res = await forkPOST(req(), ctx);
    expect(res.status).toBe(404);
    expect(mockOne).not.toHaveBeenCalled();
  });

  it('copies settings onto the forked session: title, voice (grandfathered), mode, study text, frozen scope, provenance', async () => {
    mockGetShare.mockResolvedValueOnce(SHARE);
    mockOne.mockResolvedValueOnce({ id: 'new_session' });

    const res = await forkPOST(req(), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ sessionId: 'new_session' });

    const [sql, sqlParams] = mockOne.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO sessions/);
    expect(sql).toMatch(/scope_override, forked_from_share_id/);
    const [userId, title, voice, mode, studyTextId, scopeJson, shareId] = sqlParams as string[];
    expect(userId).toBe('visitor_1');
    expect(title).toBe('On the Demiurge');
    expect(voice).toBe('woowoo'); // free forker keeps the pro voice — no tier re-check
    expect(mode).toBe('study');
    expect(studyTextId).toBe('plato-republic-7-0');
    expect(JSON.parse(scopeJson)).toEqual(SHARE.retrieval_scope);
    expect(shareId).toBe('share_1');
  });

  it('persists copied turns with zeroed accounting and bare chunk ids', async () => {
    mockGetShare.mockResolvedValueOnce(SHARE);
    mockOne.mockResolvedValueOnce({ id: 'new_session' });

    await forkPOST(req(), ctx);

    expect(mockExec).toHaveBeenCalledTimes(2); // one INSERT per copied turn
    const [sql, sqlParams] = mockExec.mock.calls[0]!;
    // Accounting literals live in the SQL: model/tier NULL, all token
    // counts and cost 0 — zero tokens keep backfill-cost.ts recomputing $0.
    expect(sql).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, NULL, NULL, 0, 0, 0, 0, \$6\)/);
    const [sessionId, userId, queryText, , chunksJson, createdAt] = sqlParams as string[];
    expect(sessionId).toBe('new_session');
    expect(userId).toBe('visitor_1'); // turns belong to the forker, not the sharer
    expect(queryText).toBe('q1');
    expect(JSON.parse(chunksJson)).toEqual(['c1', 'c2']); // bare ids, live-turn shape
    expect(createdAt).toBe('t1'); // original ordering preserved

    const secondParams = mockExec.mock.calls[1]![1] as string[];
    expect(JSON.parse(secondParams[4]!)).toEqual([]);
  });
});
