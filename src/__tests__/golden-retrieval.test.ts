/**
 * src/__tests__/golden-retrieval.test.ts
 *
 * DEPRECATED (todo:697f9e58) — superseded by the per-work golden set,
 * `golden-queries.test.ts` (+ `fixtures/golden-queries/<work>.json`), which is
 * now the SOURCE OF TRUTH for retrieval regression. This file is frozen legacy:
 * a corpus-v37-pinned 14-query snapshot, kept for its historical
 * tradition-anchored labels but no longer extended and no longer the gate. Do
 * not add queries here; add a per-work fixture instead. It stays INTEGRATION_TEST
 * -gated so it never runs in CI.
 *
 * Golden retrieval regression gate (todo:b22586bc; design §9.3). The standing
 * safety net for big retrieval changes: a frozen, corpus-pinned set of
 * domain-knowledge expectations that must keep holding.
 *
 * Two assertion kinds (see fixtures/golden-retrieval.json):
 *   - tradition-anchored: a distinctive query whose tradition is certain from
 *     comparative-religion knowledge MUST survive into top-K (tradition-level
 *     recall — not circular, since the label doesn't come from the system).
 *   - hierarchy: a high-level query MUST engage the query plane (minConcepts)
 *     and span enough traditions (minTraditions).
 *
 * Needs a live corpus + Ollama (the real retrieval path), so it's gated on
 * INTEGRATION_TEST like retrieval.integration.test.ts and skipped in CI.
 * The labels are pinned to corpus_version in the fixture; re-baseline
 * deliberately when the corpus changes.
 *
 * Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs) \
 *   INTEGRATION_TEST=1 npx vitest run src/__tests__/golden-retrieval.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import golden from './fixtures/golden-retrieval.json';
import type { UserPreferences } from '@/lib/types';

const SKIP = !process.env.INTEGRATION_TEST;

interface GoldenQuery {
  query: string;
  mustIncludeTraditions?: string[];
  minTraditions?: number;
  minConcepts?: number;
}

describe.skipIf(SKIP)(`Golden retrieval gate (corpus v${golden.corpus.corpus_version})`, () => {
  let retrieve: typeof import('@/lib/retriever').retrieve;
  let extractConcepts: typeof import('@/lib/graph').extractConcepts;

  const PREFS: UserPreferences = {
    scopeMode: 'all',
    blockedTraditions: [],
    blockedTexts: [],
    whitelistedTraditions: [],
    whitelistedTexts: [],
    preferredModel: null,
    preferredVoice: 'scholar',
  };

  beforeAll(async () => {
    retrieve = (await import('@/lib/retriever')).retrieve;
    extractConcepts = (await import('@/lib/graph')).extractConcepts;
  });

  const queries = golden.queries as GoldenQuery[];

  it.each(queries)('$query', async (g) => {
    const chunks = await retrieve(g.query, PREFS, golden.topK);
    const traditions = new Set(chunks.map(c => c.tradition));

    if (g.mustIncludeTraditions) {
      for (const t of g.mustIncludeTraditions) {
        expect(traditions, `"${g.query}" should recall ${t}; got [${[...traditions].join(', ')}]`).toContain(t);
      }
    }
    if (g.minTraditions !== undefined) {
      expect(
        traditions.size,
        `"${g.query}" spanned ${traditions.size} traditions, expected >= ${g.minTraditions}`,
      ).toBeGreaterThanOrEqual(g.minTraditions);
    }
    if (g.minConcepts !== undefined) {
      const concepts = await extractConcepts(g.query);
      expect(
        concepts.length,
        `"${g.query}" extracted ${concepts.length} concepts, expected >= ${g.minConcepts}`,
      ).toBeGreaterThanOrEqual(g.minConcepts);
    }
  }, 30_000);
});
