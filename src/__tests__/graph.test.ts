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

describe('extractConcepts — three-namespace match (todo:a72128b2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('strips LIKE wildcards from query text before building patterns', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await extractConcepts('100% divine spark_bad');

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    // '%' and '_' removed: '100 divine sparkbad' → three words, one $N each.
    expect(params).toEqual(['%100%', '%divine%', '%sparkbad%']);
    // Single UNION ALL query spanning all three namespaces.
    expect(sql).toMatch(/FROM concepts c/);
    expect(sql).toMatch(/FROM concept_families f/);
    expect(sql).toMatch(/concept_aliases/);
    expect(sql).toMatch(/family_aliases/);
  });

  it('returns empty array for queries with no words > 2 chars after sanitisation', async () => {
    const result = await extractConcepts('% _ %% __');
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns ConceptMatch[] with the matched tier from concept-namespace rows', async () => {
    mockQuery.mockResolvedValueOnce([
      { concept_id: 'divine-spark', match_tier: 'concept' },
      { concept_id: 'gnosis', match_tier: 'concept' },
    ]);

    const result = await extractConcepts('divine spark gnosis');
    expect(result).toEqual([
      { conceptId: 'divine-spark', matchTier: 'concept' },
      { conceptId: 'gnosis', matchTier: 'concept' },
    ]);
  });

  it('expands a family match to every member concept at family tier', async () => {
    mockQuery.mockResolvedValueOnce([
      { concept_id: 'atman', match_tier: 'family' },
      { concept_id: 'nous', match_tier: 'family' },
    ]);

    const result = await extractConcepts('first principles');
    expect(result).toEqual([
      { conceptId: 'atman', matchTier: 'family' },
      { conceptId: 'nous', matchTier: 'family' },
    ]);
  });

  it('tags domain-namespace expansions at domain tier', async () => {
    mockQuery.mockResolvedValueOnce([
      { concept_id: 'atman', match_tier: 'domain' },
      { concept_id: 'nous', match_tier: 'domain' },
    ]);

    const result = await extractConcepts('metaphysics');
    expect(result).toEqual([
      { conceptId: 'atman', matchTier: 'domain' },
      { conceptId: 'nous', matchTier: 'domain' },
    ]);
  });

  it('dedupes a concept matched at several tiers, keeping the strongest', async () => {
    // Same concept arrives via the domain leg (weak) and the concept leg (strong).
    mockQuery.mockResolvedValueOnce([
      { concept_id: 'atman', match_tier: 'domain' },
      { concept_id: 'atman', match_tier: 'concept' },
      { concept_id: 'nous', match_tier: 'domain' },
    ]);

    const result = await extractConcepts('metaphysics atman');
    expect(result).toEqual([
      { conceptId: 'atman', matchTier: 'concept' },
      { conceptId: 'nous', matchTier: 'domain' },
    ]);
  });

  it('returns [] when no namespace matches (e.g. alias tables empty today)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await extractConcepts('the cosmos');
    expect(result).toEqual([]);
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
    // 2nd call: EXPRESSES edges — one chunk expressing the seed concept
    mockQuery.mockResolvedValueOnce([{ source: 'chunk-1', target: 'concept-a', tier: 'verified' }]);
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

    await walkGraph([{ conceptId: 'concept-a', matchTier: 'concept' }], prefs, 25);

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

    await walkGraph([{ conceptId: 'concept-a', matchTier: 'concept' }], prefs, 25);

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

    await walkGraph([{ conceptId: 'concept-a', matchTier: 'concept' }], prefs, 25);

    const [sql, params] = chunksCall();
    expect(sql).toMatch(/tradition = ANY\(\$2::text\[\]\)/);
    expect(sql).toMatch(/text_id = ANY\(\$3::text\[\]\)/);
    expect(sql).toMatch(/LIMIT \$4\b/);
    expect(params).toEqual([['chunk-1'], ['neoplatonism'], ['enneads'], 25]);
  });
});

describe('walkGraph — reachability expansion (todo:d0b40ad4)', () => {
  beforeEach(() => vi.clearAllMocks());

  const prefs: UserPreferences = {
    scopeMode: 'all',
    blockedTraditions: [],
    blockedTexts: [],
    whitelistedTraditions: [],
    whitelistedTexts: [],
    preferredModel: null,
    preferredVoice: 'scholar',
  };

  it('reachability query uses concept→concept edge types only — EXPRESSES excluded', async () => {
    mockQuery.mockResolvedValueOnce([{ source: 'concept-a', target: 'concept-b' }]); // hop 1
    mockQuery.mockResolvedValueOnce([{ source: 'chunk-1', tier: 'verified' }]);       // EXPRESSES
    mockQuery.mockResolvedValueOnce([]);                                              // chunks

    await walkGraph([{ conceptId: 'concept-a', matchTier: 'concept' }], prefs, 25);

    // First query is the reachability hop. It must not pull EXPRESSES
    // (chunk→concept) edges into concept-graph traversal — that polluted
    // `reachable` with chunk IDs that never match the EXPRESSES lookup.
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/EXPRESSES/);
    expect(params).toEqual([['concept-a'], ['PARALLELS', 'DERIVES_FROM']]);
  });

  it('walks exactly one concept hop (HOP_DEPTH=1) before the EXPRESSES lookup', async () => {
    mockQuery.mockResolvedValueOnce([{ source: 'concept-a', target: 'concept-b' }]); // hop 1 finds new neighbour
    mockQuery.mockResolvedValueOnce([{ source: 'chunk-1', tier: 'verified' }]);       // EXPRESSES
    mockQuery.mockResolvedValueOnce([]);                                              // chunks

    await walkGraph([{ conceptId: 'concept-a', matchTier: 'concept' }], prefs, 25);

    // Even though hop 1 discovered a brand-new neighbour (concept-b), the
    // query that immediately follows is the EXPRESSES lookup — proving no
    // second reachability hop ran. Bumping HOP_DEPTH must break this.
    const secondSql = mockQuery.mock.calls[1][0];
    expect(secondSql).toMatch(/edge_type = 'EXPRESSES'/);
    // The 1-hop neighbour is included in the EXPRESSES lookup's reachable set.
    expect(mockQuery.mock.calls[1][1]).toEqual([['concept-a', 'concept-b']]);
  });
});

describe('walkGraph — match-tier weight propagation (todo:522f389a)', () => {
  beforeEach(() => vi.clearAllMocks());

  const prefs: UserPreferences = {
    scopeMode: 'all',
    blockedTraditions: [],
    blockedTexts: [],
    whitelistedTraditions: [],
    whitelistedTexts: [],
    preferredModel: null,
    preferredVoice: 'scholar',
  };

  it('stamps conceptMatchWeight = max match weight over the concepts a chunk expresses', async () => {
    mockQuery.mockResolvedValueOnce([]); // hop: no neighbours
    // chunk-1 expresses concept-a (domain → 0.25) and concept-b (concept → 1.0).
    mockQuery.mockResolvedValueOnce([
      { source: 'chunk-1', target: 'concept-a', tier: 'inferred' },
      { source: 'chunk-1', target: 'concept-b', tier: 'verified' },
    ]);
    mockQuery.mockResolvedValueOnce([{ id: 'chunk-1', tradition: 'gnosticism' }]);

    const result = await walkGraph(
      [
        { conceptId: 'concept-a', matchTier: 'domain' },
        { conceptId: 'concept-b', matchTier: 'concept' },
      ],
      prefs,
      25,
    );

    expect(result[0].conceptMatchWeight).toBe(1.0); // max(0.25, 1.0)
  });

  it('hop-discovered concepts inherit the reaching seed match weight', async () => {
    // seed concept-a matched at family tier (0.5); hop discovers concept-b.
    mockQuery.mockResolvedValueOnce([{ source: 'concept-a', target: 'concept-b' }]);
    // a chunk expresses only the hop-discovered concept-b → inherits 0.5.
    mockQuery.mockResolvedValueOnce([{ source: 'chunk-1', target: 'concept-b', tier: 'proposed' }]);
    mockQuery.mockResolvedValueOnce([{ id: 'chunk-1', tradition: 'vedanta' }]);

    const result = await walkGraph([{ conceptId: 'concept-a', matchTier: 'family' }], prefs, 25);

    expect(result[0].conceptMatchWeight).toBe(0.5);
  });
});
