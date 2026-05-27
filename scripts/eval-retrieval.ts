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
import { writeFileSync } from 'fs';
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
 *  a hardcoded expected-tradition list (which would rot as the corpus grows).
 *
 *  The trailing block is the concept-hierarchy set (todo:30dca55e §9.5): family-
 *  and domain-level phrases that go fully dark under the label-only extractConcepts
 *  (the cell-① baseline) and should start matching once the three-namespace query
 *  plane lands. Keep them here so the same harness binary measures ①/②/③. */
const QUERIES: string[] = [
  'the One', 'non-dual awareness', 'divine names', 'divine spark',
  'emanation', "the soul's ascent", 'union with God', 'ego death',
  'logos', 'void and emptiness', 'the ground of being', 'sacred fire',
  // concept-hierarchy high-level queries (handoff §6)
  'cosmology', 'the cosmos', 'cosmic agents', 'salvation',
];

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`;
}

async function main() {
  console.log(`\n=== RETRIEVAL EVAL — branch ${process.env.GIT_BRANCH ?? '(local)'} ===`);
  console.log(`top-K=${TOPK}  coverage target=${COVERAGE_TARGET} traditions\n`);
  console.log(
    [
      'query'.padEnd(22), 'concepts', 'graphCand', 'topK', 'trads', 'graphInK', 'ms', 'traditions',
    ].join('  '),
  );
  console.log('-'.repeat(100));

  let sumTrads = 0, sumGraphInK = 0, sumK = 0, sumMs = 0, maxCand = 0;
  let belowTarget = 0, graphFired = 0, zeroConcept = 0;

  // Per-query top-K capture (todo:30dca55e §9.4). Off unless EVAL_DUMP_TOPK is
  // set; the dump is the artifact two runs (cells ②/③) get diffed on to see what
  // entered/left the top-K, independent of the breadth aggregates.
  const dump: Array<{
    query: string;
    ms: number;
    concepts: number;
    graphCand: number;
    topK: Array<{ id: string; source: string; tradition: string }>;
  }> = [];

  for (const q of QUERIES) {
    const t0 = Date.now();
    const top: RetrievedChunk[] = await retrieve(q, PREFS, TOPK);
    const ms = Date.now() - t0;
    const concepts = await extractConcepts(q);
    if (concepts.length === 0) zeroConcept++;
    const graphCand = concepts.length
      ? (await walkGraph(concepts.map(c => c.conceptId), PREFS, TOPK * 2)).length
      : 0;
    if (graphCand > 0) graphFired++;

    const trads = [...new Set(top.map(c => c.tradition))];
    const graphInK = top.filter(c => c.source === 'graph').length;
    if (trads.length < COVERAGE_TARGET) belowTarget++;

    sumTrads += trads.length; sumGraphInK += graphInK; sumK += top.length;
    sumMs += ms; maxCand = Math.max(maxCand, graphCand);

    dump.push({
      query: q, ms, concepts: concepts.length, graphCand,
      topK: top.map(c => ({ id: c.id, source: c.source, tradition: c.tradition })),
    });

    console.log(
      [
        q.padEnd(22), String(concepts.length).padStart(8), String(graphCand).padStart(9),
        String(top.length).padStart(4), String(trads.length).padStart(5),
        String(graphInK).padStart(8), String(ms).padStart(4), '  ' + trads.slice(0, 5).join(', '),
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
  console.log(`  avg / total retrieve latency      : ${(sumMs / n).toFixed(0)}ms / ${sumMs}ms`);
  console.log(`  max graph candidates (blowup watch): ${maxCand}  (family/domain expansion — todo:30dca55e §5.2)`);
  console.log('');

  // EVAL_DUMP_TOPK=<path> (or =1 for the default) writes the per-query top-K so
  // two runs can be diffed mechanically. The corpus version it ran against is
  // recorded alongside so a dump is never silently compared across corpora.
  const dumpEnv = process.env.EVAL_DUMP_TOPK;
  if (dumpEnv) {
    const path = dumpEnv === '1' ? `eval-topk-${process.env.GIT_BRANCH ?? 'local'}.json` : dumpEnv;
    writeFileSync(path, JSON.stringify({ topK: TOPK, queries: dump }, null, 2));
    console.log(`[eval] wrote per-query top-K dump → ${path}\n`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
