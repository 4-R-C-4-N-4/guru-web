/**
 * src/__tests__/graph.test.ts
 *
 * Unit tests for extractConcepts wildcard sanitisation.
 * DB query is mocked.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  query:  vi.fn(),
  one:    vi.fn(),
  exec:   vi.fn(),
}));

import * as db from '@/lib/db';
const mockQuery = db.query as MockedFunction<typeof db.query>;

import { extractConcepts, walkGraph } from '@/lib/graph';
import type { UserPreferences } from '@/lib/types';

describe('extractConcepts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('strips LIKE wildcards from query text before building patterns', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await extractConcepts('100% divine spark_bad');

    expect(mockQuery).toHaveBeenCalledOnce();
    const [, params] = mockQuery.mock.calls[0];
    // '%' and '_' removed: '100 divine sparkbad' → three words
    expect(params).toEqual(['%100%', '%divine%', '%sparkbad%']);
  });

  it('returns empty array for queries with no words > 2 chars after sanitisation', async () => {
    const result = await extractConcepts('% _ %% __');
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns concept IDs from matched rows', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'divine-spark' }, { id: 'gnosis' }]);

    const result = await extractConcepts('divine spark gnosis');
    expect(result).toEqual(['divine-spark', 'gnosis']);
  });
});

describe('walkGraph — chunks-query param alignment', () => {
  // Regression for todo:1d6a6709 — buildScopeFilter was called with
  // startIndex=1, colliding with $1 chunkIds. Misaligned params bound a
  // text[] to LIMIT and prod returned 500: "argument of LIMIT must be
  // type bigint, not type text[]".

  beforeEach(() => vi.clearAllMocks());

  function mockUpToChunksQuery() {
    // 1st call: 1-hop neighbour edges — return empty
    mockQuery.mockResolvedValueOnce([]);
    // 2nd call: EXPRESSES edges — one chunk
    mockQuery.mockResolvedValueOnce([{ source: 'chunk-1', tier: 'verified' }]);
    // 3rd call: chunks fetch — returned shape doesn't matter for slot assertions
    mockQuery.mockResolvedValueOnce([]);
  }

  function chunksCall() {
    // The chunks SELECT is the 3rd query call walkGraph makes.
    return mockQuery.mock.calls[2];
  }

  it('with empty scope prefs, LIMIT binds to $2 and params are [chunkIds, limit]', async () => {
    mockUpToChunksQuery();

    const prefs: UserPreferences = {
      scopeMode: 'all',
      blockedTraditions: [],
      blockedTexts: [],
      whitelistedTraditions: [],
      whitelistedTexts: [],
      preferredModel: null,
      preferredVoice: 'scholar',
    };

    await walkGraph(['concept-a'], prefs, 25);

    const [sql, params] = chunksCall();
    expect(sql).toMatch(/LIMIT \$2\b/);
    expect(params).toEqual([['chunk-1'], 25]);
  });

  it('with blacklisted traditions, LIMIT binds to $3 and the text[] lands in $2', async () => {
    mockUpToChunksQuery();

    const prefs: UserPreferences = {
      scopeMode: 'blacklist',
      blockedTraditions: ['gnosticism'],
      blockedTexts: [],
      whitelistedTraditions: [],
      whitelistedTexts: [],
      preferredModel: null,
      preferredVoice: 'scholar',
    };

    await walkGraph(['concept-a'], prefs, 25);

    const [sql, params] = chunksCall();
    expect(sql).toMatch(/tradition <> ALL\(\$2::text\[\]\)/);
    expect(sql).toMatch(/LIMIT \$3\b/);
    expect(params).toEqual([['chunk-1'], ['gnosticism'], 25]);
  });

  it('with whitelisted traditions + texts, scope params occupy $2..$3 and LIMIT is $4', async () => {
    mockUpToChunksQuery();

    const prefs: UserPreferences = {
      scopeMode: 'whitelist',
      blockedTraditions: [],
      blockedTexts: [],
      whitelistedTraditions: ['neoplatonism'],
      whitelistedTexts: ['enneads'],
      preferredModel: null,
      preferredVoice: 'scholar',
    };

    await walkGraph(['concept-a'], prefs, 25);

    const [sql, params] = chunksCall();
    expect(sql).toMatch(/tradition = ANY\(\$2::text\[\]\)/);
    expect(sql).toMatch(/text_id = ANY\(\$3::text\[\]\)/);
    expect(sql).toMatch(/LIMIT \$4\b/);
    expect(params).toEqual([['chunk-1'], ['neoplatonism'], ['enneads'], 25]);
  });
});
