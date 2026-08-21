/**
 * src/__tests__/share-fork.test.ts
 *
 * POST /api/shares/[slug]/fork (todo:e13dd999, reworked in the PR #104
 * review): the fork must copy the snapshot's settings onto the new
 * session, freeze the scope into scope_override, and persist the copied
 * turns with ZEROED accounting (backfill-cost-safe) and bare chunk ids —
 * all in ONE data-modifying-CTE statement, so a mid-fork failure can't
 * strand an empty session.
 *
 * Voice is say-but-downgrade: a pro forker keeps the share's voice; a
 * free forker gets DEFAULT_VOICE and the response reports the downgrade
 * (creation-time gate, BRD-chat-voice §6 — a fork is a NEW session).
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ one: vi.fn(), query: vi.fn(), exec: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn() }));
vi.mock('@/lib/prompt', () => ({ DEFAULT_VOICE: 'scholar' }));
vi.mock('@/lib/chat-public', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat-public')>('@/lib/chat-public');
  return { ...actual, getShareBySlug: vi.fn() };
});

import * as db from '@/lib/db';
import * as auth from '@/lib/auth';
import * as rateLimitLib from '@/lib/rate-limit';
import * as chatPublic from '@/lib/chat-public';
import type { PublicShare } from '@/lib/chat-public';

const mockOne       = db.one                   as MockedFunction<typeof db.one>;
const mockAuth      = auth.requireUser         as MockedFunction<typeof auth.requireUser>;
const mockRateLimit = rateLimitLib.rateLimit   as MockedFunction<typeof rateLimitLib.rateLimit>;
const mockGetShare  = chatPublic.getShareBySlug as MockedFunction<typeof chatPublic.getShareBySlug>;

const { POST: forkPOST } = await import('@/app/api/shares/[slug]/fork/route');

// A FREE-tier forker forking a share made under the pro 'woowoo' voice and
// a custom scope.
const FREE_FORKER = { id: 'visitor_1', email: 'v@b.com', tier: 'free' as const, stripe_customer_id: null, payment_state: null };
const PRO_FORKER  = { id: 'visitor_2', email: 'p@b.com', tier: 'pro'  as const, stripe_customer_id: null, payment_state: null };

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
        { id: 'c1', tradition: 'gnosticism', text: 'Gospel of Philip', section: '78' },
        { id: 'c2', tradition: 'gnosticism', text: 'Gospel of Thomas', section: '22' },
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
  mockRateLimit.mockResolvedValue({ allowed: true });
});

describe('POST /api/shares/[slug]/fork', () => {
  it('404s on unknown or revoked shares (the helper filters revoked)', async () => {
    mockGetShare.mockResolvedValueOnce(null);
    const res = await forkPOST(req(), ctx);
    expect(res.status).toBe(404);
    expect(mockOne).not.toHaveBeenCalled();
  });

  it('429s with Retry-After when rate-limited, before touching the share', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 7 });
    const res = await forkPOST(req(), ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(mockGetShare).not.toHaveBeenCalled();
  });

  it('forks session + turns in a single atomic statement (no orphaned session on failure)', async () => {
    mockGetShare.mockResolvedValueOnce(SHARE);
    mockOne.mockResolvedValueOnce({ id: 'new_session' });

    const res = await forkPOST(req(), ctx);
    expect(res.status).toBe(201);

    expect(mockOne).toHaveBeenCalledTimes(1);
    const sql = mockOne.mock.calls[0]![0] as string;
    expect(sql).toMatch(/WITH s AS \(/);
    expect(sql).toMatch(/INSERT INTO sessions/);
    expect(sql).toMatch(/INSERT INTO queries/);
    expect(sql).toMatch(/jsonb_to_recordset/);
  });

  it('downgrades a pro voice for a free forker and says so (say-but-downgrade)', async () => {
    mockGetShare.mockResolvedValueOnce(SHARE);
    mockOne.mockResolvedValueOnce({ id: 'new_session' });

    const res = await forkPOST(req(), ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      sessionId: 'new_session',
      voice: 'scholar',
      voiceDowngraded: { from: 'woowoo', to: 'scholar' },
    });

    const [sql, sqlParams] = mockOne.mock.calls[0]!;
    expect(sql).toMatch(/scope_override, forked_from_share_id/);
    const [userId, title, voice, mode, studyTextId, scopeJson, shareId] = sqlParams as string[];
    expect(userId).toBe('visitor_1');
    expect(title).toBe('On the Demiurge');
    expect(voice).toBe('scholar'); // NOT woowoo — the free forker is re-gated at creation
    expect(mode).toBe('study');
    expect(studyTextId).toBe('plato-republic-7-0');
    expect(JSON.parse(scopeJson)).toEqual(SHARE.retrieval_scope);
    expect(shareId).toBe('share_1');
  });

  it('keeps the pro voice for a pro forker, with no downgrade flag', async () => {
    mockAuth.mockResolvedValueOnce(PRO_FORKER);
    mockGetShare.mockResolvedValueOnce(SHARE);
    mockOne.mockResolvedValueOnce({ id: 'new_session' });

    const res = await forkPOST(req(), ctx);
    const body = await res.json();

    expect(body).toEqual({ sessionId: 'new_session', voice: 'woowoo' });
    const voice = (mockOne.mock.calls[0]![1] as string[])[2];
    expect(voice).toBe('woowoo');
  });

  it('reports no downgrade when the share already used the default voice', async () => {
    mockGetShare.mockResolvedValueOnce({ ...SHARE, voice: 'scholar' });
    mockOne.mockResolvedValueOnce({ id: 'new_session' });

    const body = await (await forkPOST(req(), ctx)).json();
    expect(body).toEqual({ sessionId: 'new_session', voice: 'scholar' });
  });

  it('persists copied turns with zeroed accounting and bare chunk ids', async () => {
    mockGetShare.mockResolvedValueOnce(SHARE);
    mockOne.mockResolvedValueOnce({ id: 'new_session' });

    await forkPOST(req(), ctx);

    const [sql, sqlParams] = mockOne.mock.calls[0]!;
    // Accounting literals live in the SQL: model/tier NULL, all token
    // counts and cost 0 — zero tokens keep backfill-cost.ts recomputing $0.
    expect(sql).toMatch(/NULL, NULL, 0, 0, 0, 0/);

    const turns = JSON.parse((sqlParams as string[])[7]!);
    expect(turns).toEqual([
      { query_text: 'q1', response_text: 'r1', chunks_used: ['c1', 'c2'], created_at: 't1' },
      { query_text: 'q2', response_text: 'r2', chunks_used: [],           created_at: 't2' },
    ]);
  });
});
