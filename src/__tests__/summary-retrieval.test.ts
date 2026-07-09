/**
 * src/__tests__/summary-retrieval.test.ts
 *
 * W3 (todo:5ba89b0a, summary-phase-w.md): the study-mode summary leg.
 *  - buildSummaryScopeFilter: text-level scope via works-membership overlap
 *    (the W0 NULL-text_id fix), tradition-level verbatim.
 *  - summarySearch: UNION-compatible column shape, work pinning, tier tag.
 *  - retrieve(): chat-mode non-regression (no summary leg), study-mode wiring.
 *  - mergeAndRerank: per-tradition cap override for pinned (single-tradition)
 *    study works; summary rows keep their tier.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  one:   vi.fn(),
  exec:  vi.fn(),
}));
vi.mock('@/lib/embed', () => ({
  embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import * as db from '@/lib/db';
const mockQuery = db.query as MockedFunction<typeof db.query>;
const mockOne   = db.one   as MockedFunction<typeof db.one>;

import { buildSummaryScopeFilter } from '@/lib/graph';
import { retrieve, summarySearch, mergeAndRerank } from '@/lib/retriever';
import type { RetrievedChunk, UserPreferences } from '@/lib/types';

const OPEN_PREFS: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [],
} as unknown as UserPreferences;

beforeEach(() => vi.clearAllMocks());

describe('buildSummaryScopeFilter (W0 finding 3)', () => {
  it('applies text blacklists via membership overlap, never text_id — the NULL-text_id L2 fixture', () => {
    // Fixture rationale: a multi-member L2 row has text_id IS NULL. Under
    // buildScopeFilter's `text_id <> ALL($n)` that predicate is NULL and the
    // row silently vanishes even when the blocked text is unrelated
    // (demonstrated live in W0 with kalevala blocked dropping the
    // gnostic-john-baptizer L2). The overlap form never references text_id.
    const { where, params } = buildSummaryScopeFilter(
      { ...OPEN_PREFS, scopeMode: 'blacklist', blockedTexts: ['kalevala'] }, 2);
    expect(where).toBe('NOT (w.member_text_ids && $2::text[])');
    expect(where).not.toMatch(/\btext_id\b/);
    expect(params).toEqual([['kalevala']]);
  });

  it('applies text whitelists via membership overlap — grouped L2s stay reachable', () => {
    const { where } = buildSummaryScopeFilter(
      { ...OPEN_PREFS, scopeMode: 'whitelist', whitelistedTexts: ['gnostic-john-baptizer-2'] }, 2);
    expect(where).toBe('w.member_text_ids && $2::text[]');
    expect(where).not.toMatch(/\btext_id\b/);
  });

  it('applies tradition conditions verbatim on the summary row', () => {
    const bl = buildSummaryScopeFilter(
      { ...OPEN_PREFS, scopeMode: 'blacklist', blockedTraditions: ['finnic'] }, 2);
    expect(bl.where).toBe('s.tradition <> ALL($2::text[])');
    const wl = buildSummaryScopeFilter(
      { ...OPEN_PREFS, scopeMode: 'whitelist', whitelistedTraditions: ['gnosticism'] }, 2);
    expect(wl.where).toBe('s.tradition = ANY($2::text[])');
  });

  it('returns TRUE for open scope and advances paramIndex correctly', () => {
    const open = buildSummaryScopeFilter(OPEN_PREFS, 2);
    expect(open.where).toBe('TRUE');
    expect(open.paramIndex).toBe(2);
    const both = buildSummaryScopeFilter(
      { ...OPEN_PREFS, scopeMode: 'blacklist', blockedTraditions: ['finnic'], blockedTexts: ['kalevala'] }, 2);
    expect(both.paramIndex).toBe(4);
  });
});

describe('summarySearch (W3 leg)', () => {
  it('emits the UNION-compatible column shape with the W0 COALESCEs', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await summarySearch('what is the cave allegory', OPEN_PREFS, 5);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(s\.text_id, s\.work_id\)\s+AS text_id/);
    expect(sql).toMatch(/COALESCE\(tx\.label, w\.label\)\s+AS text_name/);
    expect(sql).toMatch(/COALESCE\(s\.section_span, 'Whole work'\)\s+AS section/);
    expect(sql).toMatch(/NULL::text\s+AS translator/);
    expect(sql).toMatch(/'summary' AS source/);
    expect(sql).toMatch(/JOIN works w\s+ON w\.id = s\.work_id/);
    expect(sql).toMatch(/LEFT JOIN texts tx ON tx\.id = s\.text_id/);
  });

  it('pins to the study work and tags rows tier=summary', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 'sum:plato-republic', text_id: 'plato-republic', tradition: 'platonism',
      text_name: 'Plato: Republic', section: 'Whole work', translator: null,
      body: 'x', token_count: 10, distance: 0.3, source: 'summary',
    }] as never);
    const rows = await summarySearch('justice', OPEN_PREFS, 5, 'plato-republic');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/AND s\.work_id = \$2/);
    expect(params).toEqual([JSON.stringify([0.1, 0.2, 0.3]), 'plato-republic', 5]);
    expect(rows[0].tier).toBe('summary');
  });
});

describe('retrieve() mode wiring', () => {
  it('chat mode issues no summary_nodes query (tuned path non-regression)', async () => {
    mockQuery.mockResolvedValue([]);
    await retrieve('anything', OPEN_PREFS, 5);
    expect(mockOne).not.toHaveBeenCalled();
    for (const [sql] of mockQuery.mock.calls) {
      expect(String(sql)).not.toMatch(/summary_nodes/);
    }
  });

  it('study mode resolves the pin, scopes chunk legs to members, runs the summary leg', async () => {
    mockOne.mockResolvedValueOnce({
      work_id: 'gnostic-john-baptizer', tradition: 'mandaean',
      member_text_ids: ['gnostic-john-baptizer-1', 'gnostic-john-baptizer-2'],
    });
    mockQuery.mockResolvedValue([]);
    await retrieve('who baptizes', OPEN_PREFS, 5, 'study', 'gnostic-john-baptizer-2');

    const [pinSql, pinParams] = mockOne.mock.calls[0]!;
    expect(pinSql).toMatch(/JOIN works w ON w\.id = t\.work_id/);
    expect(pinParams).toEqual(['gnostic-john-baptizer-2']);

    const sqls = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sqls.some(q => /summary_nodes/.test(q))).toBe(true);
    // chunk legs whitelist the members (pin via buildScopeFilter's whitelist path)
    const vectorCall = mockQuery.mock.calls.find(c => /FROM chunks/.test(String(c[0])) && /embedding/.test(String(c[0])));
    expect(vectorCall![1]).toContainEqual(['gnostic-john-baptizer-1', 'gnostic-john-baptizer-2']);
  });
});

describe('retrieve() study scope semantics (review findings)', () => {
  it('ANDs the pin with a user blacklist: a blocked member text stays excluded', async () => {
    mockOne.mockResolvedValueOnce({
      work_id: 'gnostic-john-baptizer', tradition: 'mandaean',
      member_text_ids: ['gnostic-john-baptizer-1', 'gnostic-john-baptizer-2'],
    });
    mockQuery.mockResolvedValue([]);
    await retrieve('q', {
      ...OPEN_PREFS, scopeMode: 'blacklist', blockedTexts: ['gnostic-john-baptizer-1'],
    } as UserPreferences, 5, 'study', 'gnostic-john-baptizer-2');
    const vectorCall = mockQuery.mock.calls.find(c => /FROM chunks/.test(String(c[0])) && /embedding/.test(String(c[0])));
    expect(vectorCall![1]).toContainEqual(['gnostic-john-baptizer-2']); // blocked member removed
  });

  it('returns [] when the blacklist covers the pinned work tradition', async () => {
    mockOne.mockResolvedValueOnce({
      work_id: 'kalevala', tradition: 'finnic', member_text_ids: ['kalevala'],
    });
    const out = await retrieve('q', {
      ...OPEN_PREFS, scopeMode: 'blacklist', blockedTraditions: ['finnic'],
    } as UserPreferences, 5, 'study', 'kalevala');
    expect(out).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled(); // fail closed before any leg runs
  });

  it('fails closed on a stale pin (text gone after a corpus swap)', async () => {
    mockOne.mockResolvedValueOnce(null);
    const out = await retrieve('q', OPEN_PREFS, 5, 'study', 'removed-text-id');
    expect(out).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('mergeAndRerank study-mode behaviours', () => {
  const chunk = (id: string, source: RetrievedChunk['source'], distance = 0.3): RetrievedChunk => ({
    id, text_id: 't', tradition: 'platonism', text_name: 'T', section: '1',
    translator: null, body: 'b', token_count: 5, distance, source,
  } as RetrievedChunk);

  it('summary rows keep tier=summary through the vector pool', () => {
    const out = mergeAndRerank([chunk('c1', 'vector'), { ...chunk('s1', 'summary'), tier: 'summary' }], [], 5);
    expect(out.find(c => c.id === 's1')!.tier).toBe('summary');
    expect(out.find(c => c.id === 'c1')!.tier).toBe('inferred');
  });

  it('perTraditionCap: 0 lifts the cap for single-tradition study works', () => {
    const five = [1, 2, 3, 4, 5].map(i => chunk(`c${i}`, 'vector', 0.1 * i));
    expect(mergeAndRerank(five, [], 5).length).toBe(3);            // default cap
    expect(mergeAndRerank(five, [], 5, { perTraditionCap: 0 }).length).toBe(5);
  });
});
