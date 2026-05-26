/**
 * scripts/eval-retrieval.ts
 *
 * Retrieval eval harness (todo:53901cb3). Runs a fixed set of canonical
 * comparative-religion queries through the FULL retrieve() pipeline against
 * the live local corpus and reports the metrics that tell us whether the
 * scoring is doing its job:
 *
 *   - top-K distinct-tradition coverage   (is the graph leg surfacing
 *                                           cross-tradition parallels?)
 *   - graph vs vector source mix in top-K (how much does the graph leg
 *                                           actually contribute after rerank?)
 *   - per-leg diagnostics                  (concepts extracted, graph
 *                                           candidates produced)
 *
 * It is scoring-agnostic: run it once now to capture the BASELINE (current
 * multiplicative scoring), then re-run after the additive scorer (fbf4652f)
 * lands and diff the aggregates. That diff is the answer to "did the fix help?"
 *
 * Requires a live local corpus + Ollama embeddings.
 * Run:
 *   export $(grep -E '^DATABASE_URL=' .env | xargs) && npx tsx scripts/eval-retrieval.ts
 */
import { retrieve } from '../src/lib/retriever';
import { extractConcepts, walkGraph } from '../src/lib/graph';
import type { UserPreferences, RetrievedChunk } from '../src/lib/types';

const PREFS: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [],
  preferredModel: null, preferredVoice: 'scholar',
};

const TOPK = 15;
/** A good comparative-religion result should span multiple traditions. */
const COVERAGE_TARGET = 3;

/** Canonical queries. `themes` is informational — the metric is breadth, not
 *  a hardcoded expected-tradition list (which would rot as the corpus grows). */
const QUERIES: string[] = [
  'the One', 'non-dual awareness', 'divine names', 'divine spark',
  'emanation', "the soul's ascent", 'union with God', 'ego death',
  'logos', 'void and emptiness', 'the ground of being', 'sacred fire',
];

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`;
}

async function main() {
  console.log(`\n=== RETRIEVAL EVAL — branch ${process.env.GIT_BRANCH ?? '(local)'} ===`);
  console.log(`top-K=${TOPK}  coverage target=${COVERAGE_TARGET} traditions\n`);
  console.log(
    [
      'query'.padEnd(22), 'concepts', 'graphCand', 'topK', 'trads', 'graphInK', 'traditions',
    ].join('  '),
  );
  console.log('-'.repeat(100));

  let sumTrads = 0, sumGraphInK = 0, sumK = 0;
  let belowTarget = 0, graphFired = 0, zeroConcept = 0;

  for (const q of QUERIES) {
    const top: RetrievedChunk[] = await retrieve(q, PREFS, TOPK);
    const concepts = await extractConcepts(q);
    if (concepts.length === 0) zeroConcept++;
    const graphCand = concepts.length ? (await walkGraph(concepts, PREFS, TOPK * 2)).length : 0;
    if (graphCand > 0) graphFired++;

    const trads = [...new Set(top.map(c => c.tradition))];
    const graphInK = top.filter(c => c.source === 'graph').length;
    if (trads.length < COVERAGE_TARGET) belowTarget++;

    sumTrads += trads.length; sumGraphInK += graphInK; sumK += top.length;

    console.log(
      [
        q.padEnd(22), String(concepts.length).padStart(8), String(graphCand).padStart(9),
        String(top.length).padStart(4), String(trads.length).padStart(5),
        String(graphInK).padStart(8), '  ' + trads.slice(0, 5).join(', '),
      ].join('  '),
    );
  }

  const n = QUERIES.length;
  console.log('-'.repeat(100));
  console.log('\nAGGREGATES (this is the baseline to diff against after the scorer lands):');
  console.log(`  avg distinct traditions in top-K : ${(sumTrads / n).toFixed(2)}  (target ${COVERAGE_TARGET})`);
  console.log(`  queries below coverage target    : ${belowTarget}/${n}`);
  console.log(`  graph-sourced share of top-K slots: ${sumGraphInK}/${sumK}  (${pct(sumGraphInK, sumK)})`);
  console.log(`  graph leg fired (candidates > 0)  : ${graphFired}/${n}`);
  console.log(`  queries extracting 0 concepts     : ${zeroConcept}/${n}  (graph leg dark — see todo:53480da1)`);
  console.log('');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
