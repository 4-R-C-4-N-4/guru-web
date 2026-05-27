/**
 * src/__tests__/retrieval.integration.test.ts
 *
 * Golden-query integration tests for the full retrieval pipeline.
 * Requires a seeded local Postgres (npm run migrate && npm run seed-dev).
 *
 * Skipped automatically unless INTEGRATION_TEST=1 is set, so CI passes
 * without a live database.
 *
 * Run locally:
 *   DATABASE_URL=postgresql://guru:guru_dev@localhost:5432/guru \
 *   OPENROUTER_API_KEY=sk-... \
 *   INTEGRATION_TEST=1 \
 *   npx vitest run src/__tests__/retrieval.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';

const SKIP = !process.env.INTEGRATION_TEST;

describe.skipIf(SKIP)('Retrieval pipeline — integration', () => {
  // Lazy imports so the module-level db pool is not created unless we're actually running
  let retrieve: typeof import('@/lib/retriever').retrieve;
  let buildPrompt: typeof import('@/lib/prompt').buildPrompt;

  const PREFS = {
    scopeMode: 'all' as const,
    blockedTraditions: [],
    blockedTexts: [],
    whitelistedTraditions: [],
    whitelistedTexts: [],
    preferredModel: null,
    preferredVoice: 'scholar' as const,
  };

  beforeAll(async () => {
    const retrieverMod = await import('@/lib/retriever');
    const promptMod    = await import('@/lib/prompt');
    retrieve    = retrieverMod.retrieve;
    buildPrompt = promptMod.buildPrompt;
  });

  it('golden query: "divine spark" returns chunks from seeded corpus', async () => {
    const chunks = await retrieve('divine spark', PREFS, 5);
    expect(chunks.length).toBeGreaterThan(0);
    // Should include at least one Gnosticism chunk (gt-77 in seed data)
    const traditions = chunks.map(c => c.tradition);
    expect(traditions).toContain('gnosticism');
  }, 30_000);

  it('golden query: "atman brahman" returns Vedanta chunks', async () => {
    const chunks = await retrieve('atman brahman', PREFS, 5);
    expect(chunks.length).toBeGreaterThan(0);
    const traditions = chunks.map(c => c.tradition);
    expect(traditions).toContain('vedanta');
  }, 30_000);

  it('buildPrompt produces a non-empty prompt with citations', async () => {
    const chunks = await retrieve('divine spark light', PREFS, 5);
    const prompt = buildPrompt('What is the divine spark?', chunks, PREFS, 'free');
    expect(prompt).toContain('SOURCE PASSAGES');
    expect(prompt).toContain('What is the divine spark?');
    expect(prompt.length).toBeGreaterThan(100);
  }, 30_000);

  it('scope blacklist filters out blocked traditions', async () => {
    const prefsBlocked = {
      ...PREFS,
      scopeMode: 'blacklist' as const,
      blockedTraditions: ['gnosticism'],
    };
    const chunks = await retrieve('divine spark', prefsBlocked, 10);
    const traditions = chunks.map(c => c.tradition);
    expect(traditions).not.toContain('gnosticism');
  }, 30_000);
});

/**
 * Concept-hierarchy query expansion (todo:2152ea81). These assert the *graph leg*
 * mechanism on the seeded tree (seed-dev: domain `metaphysics` → family
 * `metaphysics.first_principles` → atman/nous), so they're deterministic and do
 * NOT depend on embeddings — seed-dev zeroes the vectors, so the vector leg is
 * degenerate here (caveat, spec §9.7). The prod-corpus high-level queries the
 * handoff names (`cosmology`, `the cosmos`, `salvation`) are exercised by
 * scripts/eval-retrieval.ts against the real corpus, not here.
 *
 * Pre-hierarchy, family/domain phrases extracted 0 concepts and the graph leg
 * went dark (todo:53480da1); these are the regression tripwires that it fires.
 */
describe.skipIf(SKIP)('Concept hierarchy — query expansion (integration)', () => {
  let extractConcepts: typeof import('@/lib/graph').extractConcepts;
  let walkGraph: typeof import('@/lib/graph').walkGraph;

  const PREFS = {
    scopeMode: 'all' as const,
    blockedTraditions: [],
    blockedTexts: [],
    whitelistedTraditions: [],
    whitelistedTexts: [],
    preferredModel: null,
    preferredVoice: 'scholar' as const,
  };

  beforeAll(async () => {
    const graphMod = await import('@/lib/graph');
    extractConcepts = graphMod.extractConcepts;
    walkGraph = graphMod.walkGraph;
  });

  it('concept query "atman" matches at concept tier', async () => {
    const matches = await extractConcepts('atman');
    expect(matches).toContainEqual({ conceptId: 'atman', matchTier: 'concept' });
  }, 30_000);

  it('family query "first principles" expands to its member concepts at family tier', async () => {
    const matches = await extractConcepts('first principles');
    const byId = new Map(matches.map(m => [m.conceptId, m.matchTier]));
    expect(byId.get('atman')).toBe('family');
    expect(byId.get('nous')).toBe('family');
  }, 30_000);

  it('domain query "metaphysics" expands to all concepts under it (was empty pre-hierarchy)', async () => {
    const matches = await extractConcepts('metaphysics');
    expect(matches.length).toBeGreaterThan(0);
    const ids = matches.map(m => m.conceptId);
    expect(ids).toEqual(expect.arrayContaining(['atman', 'nous']));
    expect(matches.every(m => m.matchTier === 'domain')).toBe(true);
  }, 30_000);

  it('graph leg surfaces chunks for a domain query, stamped with the domain match weight', async () => {
    const matches = await extractConcepts('metaphysics');
    const chunks = await walkGraph(matches, PREFS, 10);
    expect(chunks.length).toBeGreaterThan(0); // cu-6-8 EXPRESSES atman in seed data
    expect(chunks.every(c => c.source === 'graph')).toBe(true);
    // domain-tier expansion → 0.25 (MATCH_TIER_WEIGHTS)
    expect(chunks.some(c => c.conceptMatchWeight === 0.25)).toBe(true);
  }, 30_000);
});
