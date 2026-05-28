/**
 * scripts/eval-tuning.ts
 *
 * Retrieval pool-width tuning sweep (todo:60466c56). Sweeps RETRIEVAL_POOL_MULT
 * and reports the recall↑ / precision↓ tradeoff so a weight change can be chosen
 * on data, not vibes. Holds the query set + corpus constant; only the lever moves.
 *
 * Metrics per config:
 *   - tailRecall   : of the knownGaps (under-showing traditions), how many now
 *                    surface their expected tradition in top-K  (UPSIDE)
 *   - anchored     : of the golden tradition-anchored queries, how many still
 *                    recall their must-include tradition       (no-eviction guard)
 *   - headStable   : mean top-5 chunk-id overlap vs the mult=2 baseline across all
 *                    queries — a label-free PRECISION PROXY (a fair-surfacing lever
 *                    should perturb the tail, not churn the trusted head)
 *   - avgMs        : mean retrieve() latency (cost of a wider pool)
 *
 * Not a substitute for human-rated relevance — headStable measures churn, not
 * correctness; treat it as "did we wreck the common case", paired with anchored.
 *
 * Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs) \
 *   npx tsx scripts/eval-tuning.ts
 */
import golden from '../src/__tests__/fixtures/golden-retrieval.json';
import { retrieve } from '../src/lib/retriever';
import type { UserPreferences } from '../src/lib/types';

const PREFS: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [], preferredModel: null, preferredVoice: 'scholar',
};

const CONFIGS = [2, 6, 10, 15, 20];
const TOPK = 15;

interface GQ { query: string; mustIncludeTraditions?: string[] }
const gq = golden.queries as GQ[];
const anchored = gq.filter(q => q.mustIncludeTraditions?.length);
const gaps = (golden as { knownGaps: { cases: { query: string; expectedTradition: string }[] } })
  .knownGaps.cases;
const allQueries = [...new Set([...gq.map(q => q.query), ...gaps.map(g => g.query)])];

async function runConfig(mult: number) {
  process.env.RETRIEVAL_POOL_MULT = String(mult);
  const top5: Record<string, string[]> = {};
  const trads: Record<string, string[]> = {};
  let totalMs = 0;
  for (const q of allQueries) {
    const t0 = Date.now();
    const chunks = await retrieve(q, PREFS, TOPK);
    totalMs += Date.now() - t0;
    top5[q] = chunks.slice(0, 5).map(c => c.id);
    trads[q] = chunks.map(c => c.tradition);
  }
  return { top5, trads, avgMs: totalMs / allQueries.length };
}

async function main() {
  console.log(`\n=== POOL-WIDTH SWEEP (corpus v${golden.corpus.corpus_version}) ===`);
  console.log(`queries=${allQueries.length}  gaps=${gaps.length}  anchored=${anchored.length}  topK=${TOPK}\n`);

  let baseTop5: Record<string, string[]> | null = null;
  const rows: Record<string, string>[] = [];

  for (const mult of CONFIGS) {
    const r = await runConfig(mult);
    if (!baseTop5) baseTop5 = r.top5;

    const tail = gaps.filter(g => r.trads[g.query]?.includes(g.expectedTradition)).length;
    const anch = anchored.filter(q => q.mustIncludeTraditions!.every(t => r.trads[q.query]?.includes(t))).length;

    let overlap = 0;
    for (const q of allQueries) {
      const base = new Set(baseTop5[q]);
      overlap += r.top5[q].filter(id => base.has(id)).length / 5;
    }
    const headStable = overlap / allQueries.length;

    rows.push({
      poolMult: `x${mult}`,
      tailRecall: `${tail}/${gaps.length}`,
      anchored: `${anch}/${anchored.length}`,
      headStable: headStable.toFixed(2),
      avgMs: r.avgMs.toFixed(0),
    });
  }

  console.table(rows);
  console.log('\nRead: tailRecall ↑ is the win; anchored must stay full (no eviction);');
  console.log('headStable drop is the precision cost (1.00 = head unchanged vs x2 baseline).\n');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
