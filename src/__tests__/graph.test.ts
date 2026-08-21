/**
 * src/__tests__/graph.test.ts
 *
 * Unit tests for extractConcepts wildcard sanitisation.
 * DB query is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  query:  vi.fn(),
  one:    vi.fn(),
  exec:   vi.fn(),
}));

import * as db from '@/lib/db';
const mockQuery = db.query as MockedFunction<typeof db.query>;

import { extractConcepts, walkGraph, summarizeExpansion } from '@/lib/graph';
import type { UserPreferences } from '@/lib/types';

describe('extractConcepts — three-namespace match (todo:a72128b2)', () => {
  // These assert LIKE-format params (the original substring matcher). Pin the
  // mode so they keep testing tokenisation against the stable %word% vehicle;
  // the matcher default flipped to regex in todo:72f1334e.
  beforeEach(() => { vi.clearAllMocks(); process.env.GRAPH_MATCH_MODE = 'like'; });
  afterEach(() => { delete process.env.GRAPH_MATCH_MODE; });

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

  it('drops function-word stopwords so they cannot substring-match labels (todo:597d86a4)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await extractConcepts('what is the tao');
    expect(mockQuery).toHaveBeenCalledOnce();
    const [, params] = mockQuery.mock.calls[0];
    // 'what'/'the' are stopwords, 'is' is ≤2 chars — only 'tao' survives, so
    // 'the' can no longer match 'Theology'.
    expect(params).toEqual(['%tao%']);
  });

  it('keeps meaningful short content words — the One, the All (todo:597d86a4)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await extractConcepts('the One and the All');
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['%one%', '%all%']);
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

describe('summarizeExpansion — query-expansion transparency (todo:9d2ad427)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns [] for queries with no usable words (no DB call)', async () => {
    const result = await summarizeExpansion('% _ a');
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('maps family/domain rows to {tier,label,conceptCount}', async () => {
    mockQuery.mockResolvedValueOnce([
      { tier: 'domain', label: 'Cosmology', n: 7 },
      { tier: 'family', label: 'Cosmic Agents', n: 3 },
    ]);

    const result = await summarizeExpansion('cosmology cosmic agents');
    expect(result).toEqual([
      { tier: 'domain', label: 'Cosmology', conceptCount: 7 },
      { tier: 'family', label: 'Cosmic Agents', conceptCount: 3 },
    ]);
  });

  it('shares the stopword tokenizer — drops function words too (todo:597d86a4)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await summarizeExpansion('what is the tao');
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['%tao%']);
  });

  it('collapses duplicate label/alias rows for the same family', async () => {
    mockQuery.mockResolvedValueOnce([
      { tier: 'family', label: 'Liberation', n: 4 },
      { tier: 'family', label: 'Liberation', n: 4 }, // matched again via an alias
    ]);

    const result = await summarizeExpansion('liberation');
    expect(result).toEqual([{ tier: 'family', label: 'Liberation', conceptCount: 4 }]);
  });
});

describe('walkGraph — chunks-query param alignment', () => {
  // Regression for todo:1d6a6709 — buildScopeFilter was called with
  // startIndex=1, colliding with $1 chunkIds. Misaligned params bound a
  // text[] to LIMIT and prod returned 500: "argument of LIMIT must be
  // type bigint, not type text[]".

  beforeEach(() => vi.clearAllMocks());

  function mockUpToChunksQuery() {
    // 1st call: EXPRESSES edges — one chunk expressing the seed concept
    mockQuery.mockResolvedValueOnce([{ source: 'chunk-1', target: 'concept-a', tier: 'verified' }]);
    // 2nd call: chunks fetch — returned shape doesn't matter for slot assertions
    mockQuery.mockResolvedValueOnce([]);
  }

  function chunksCall() {
    // The chunks SELECT is the 2nd query call walkGraph makes.
    return mockQuery.mock.calls[1];
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

  it('with blacklisted TEXTS only, text_id filter lands in $2 and LIMIT in $3 (todo:2d0cbfab)', async () => {
    // The per-text scope path the settings checkboxes feed on every chat
    // query. Until 2026-07 no test passed a non-empty blockedTexts through
    // walkGraph — the predicate existed but a param-slot regression would
    // have shipped silently.
    mockUpToChunksQuery();

    const prefs: UserPreferences = {
      scopeMode: 'blacklist',
      blockedTraditions: [],
      blockedTexts: ['dhp.1', 'dhp.2'],
      whitelistedTraditions: [],
      whitelistedTexts: [],
      preferredModel: null,
      preferredVoice: 'scholar',
    };

    await walkGraph([{ conceptId: 'concept-a', matchTier: 'concept' }], prefs, 25);

    const [sql, params] = chunksCall();
    expect(sql).toMatch(/text_id <> ALL\(\$2::text\[\]\)/);
    expect(sql).not.toMatch(/tradition <> ALL/);
    expect(sql).toMatch(/LIMIT \$3\b/);
    expect(params).toEqual([['chunk-1'], ['dhp.1', 'dhp.2'], 25]);
  });

  it('with blacklisted traditions AND texts, both predicates bind $2/$3 and LIMIT is $4', async () => {
    mockUpToChunksQuery();

    const prefs: UserPreferences = {
      scopeMode: 'blacklist',
      blockedTraditions: ['gnosticism'],
      blockedTexts: ['kalevala'],
      whitelistedTraditions: [],
      whitelistedTexts: [],
      preferredModel: null,
      preferredVoice: 'scholar',
    };

    await walkGraph([{ conceptId: 'concept-a', matchTier: 'concept' }], prefs, 25);

    const [sql, params] = chunksCall();
    expect(sql).toMatch(/tradition <> ALL\(\$2::text\[\]\)/);
    expect(sql).toMatch(/text_id <> ALL\(\$3::text\[\]\)/);
    expect(sql).toMatch(/LIMIT \$4\b/);
    expect(params).toEqual([['chunk-1'], ['gnosticism'], ['kalevala'], 25]);
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

describe('walkGraph — no reachability expansion (todo:23298aa9)', () => {
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

  it('issues no concept→concept hop — the first query is the EXPRESSES lookup', async () => {
    mockQuery.mockResolvedValueOnce([{ source: 'chunk-1', target: 'concept-a', tier: 'verified' }]); // EXPRESSES
    mockQuery.mockResolvedValueOnce([]);                                                             // chunks

    await walkGraph([{ conceptId: 'concept-a', matchTier: 'concept' }], prefs, 25);

    // The old PARALLELS/DERIVES_FROM reachability hop could never match on
    // this corpus (PARALLELS endpoints are chunk ids; DERIVES_FROM has zero
    // rows) and was removed. walkGraph goes straight to the EXPRESSES lookup
    // over the seed concepts, and makes exactly two queries in total.
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/edge_type = 'EXPRESSES'/);
    expect(sql).not.toMatch(/PARALLELS|DERIVES_FROM/);
    expect(params).toEqual([['concept-a']]);
    expect(mockQuery.mock.calls).toHaveLength(2);
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
});

describe('extractConcepts — matcher mode (todo:72f1334e)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { delete process.env.GRAPH_MATCH_MODE; });

  it('defaults to regex whole-word matching via ~* word-boundary patterns', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await extractConcepts('man wu-wei');
    const [sql, params] = mockQuery.mock.calls[0];
    // whole-word, letter-flanked patterns — 'man' will NOT match inside 'eMANation'.
    expect(params).toEqual([
      '(^|[^[:alpha:]])man([^[:alpha:]]|$)',
      '(^|[^[:alpha:]])wu-wei([^[:alpha:]]|$)', // hyphen passes through unescaped
    ]);
    expect(sql).toMatch(/~\* \$1/);
    expect(sql).not.toMatch(/LIKE \$/);
  });

  it('GRAPH_MATCH_MODE=like opts back into LIKE substring matching', async () => {
    process.env.GRAPH_MATCH_MODE = 'like';
    mockQuery.mockResolvedValueOnce([]);
    await extractConcepts('mania');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['%mania%']);
    expect(sql).toMatch(/LIKE \$1/);
    expect(sql).not.toMatch(/~\*/);
  });

  it('escapes regex metacharacters in tokens', async () => {
    process.env.GRAPH_MATCH_MODE = 'regex';
    mockQuery.mockResolvedValueOnce([]);
    await extractConcepts('a.b(c'); // one token after tokenisation
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['(^|[^[:alpha:]])a\\.b\\(c([^[:alpha:]]|$)']);
  });
});
