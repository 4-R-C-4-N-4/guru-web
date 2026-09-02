/**
 * scripts/measure-retrieval.ts (todo:697f9e58 / todo:19ea34ea)
 *
 * Retrieval diagnostic: reproduce the exact topK candidate pool and read the
 * FULL, untruncated score order — so you can see where a *missing* target
 * actually scored and which works crowd the slots above it. This is the harness
 * behind the §5/§6 rank numbers in docs/retrieval-golden-gap-investigation.md,
 * committed (not throwaway) so the retrieval-quality follow-up can re-measure
 * without re-deriving it.
 *
 * Why not just retrieve(): retrieve() truncates to topK and applies the caps,
 * so it can't show a buried target's rank. And the intake pools scale with topK
 * (vector topK*10, graph/lexical topK*2), so retrieve(q,15) and retrieve(q,120)
 * are DIFFERENT computations — a "rank" only means something relative to the
 * pool that produced it. This script always reproduces the topK pool faithfully.
 *
 * Prereqs (same as the golden gate): docker Postgres with the corpus loaded +
 * Ollama with nomic-embed-text. See the doc's §9.1.
 *
 * Usage:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs)
 *   npx tsx scripts/measure-retrieval.ts "<query>" [--target <work-or-text-id>] [--topk 15] [--cap 0] [--show 20]
 *
 * Example (the pistis-sophia failing probe):
 *   npx tsx scripts/measure-retrieval.ts \
 *     "after rising from the dead the savior teaches his circle for eleven years" \
 *     --target pistis-sophia
 */
import 'dotenv/config';
import { vectorSearch, lexicalSearch, mergeAndRerank } from '../src/lib/retriever';
import { extractConcepts, walkGraph } from '../src/lib/graph';
import { query } from '../src/lib/db';
import type { UserPreferences, RetrievedChunk } from '../src/lib/types';

const PREFS: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [],
  preferredModel: null, preferredVoice: 'scholar',
};

interface Args {
  q: string;
  target: string | null;
  topK: number;
  cap: number;
  show: number;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) opt[a.slice(2)] = argv[++i] ?? '';
    else positional.push(a);
  }
  return {
    q: positional.join(' '),
    target: opt.target ?? null,
    topK: Number(opt.topk) || 15,
    cap: Number(opt.cap) || 0,
    show: Number(opt.show) || 20,
  };
}

// Member text_ids of a work id; falls back to treating the arg as a bare text_id.
async function memberTextIds(target: string): Promise<string[]> {
  const rows = await query<{ m: string[] }>(
    'SELECT member_text_ids m FROM works WHERE id = $1', [target],
  );
  return rows.length && rows[0].m?.length ? rows[0].m : [target];
}

// Faithful topK candidate pool, fully scored, UNTRUNCATED, in pure score order
// (perTraditionCap:0 so nothing is dropped or reordered by the cap).
async function scoredOrder(q: string, topK: number): Promise<RetrievedChunk[]> {
  const [v, lex] = await Promise.all([
    vectorSearch(q, PREFS, topK * 10),
    lexicalSearch(q, PREFS, topK * 2),
  ]);
  const concepts = await extractConcepts(q);
  const g = concepts.length ? await walkGraph(concepts, PREFS, topK * 2) : [];
  return mergeAndRerank(v, g, 99999, { lexicalResults: lex, perTraditionCap: 0 });
}

async function main(): Promise<void> {
  const { q, target, topK, cap, show } = parseArgs(process.argv.slice(2));
  if (!q) {
    console.error('usage: measure-retrieval.ts "<query>" [--target <work>] [--topk 15] [--cap 0] [--show 20]');
    process.exit(1);
  }
  const order = await scoredOrder(q, topK);
  const members = target ? await memberTextIds(target) : [];

  console.log(`query: ${q}`);
  console.log(`pool: ${order.length} candidates (topK=${topK} => vector ${topK * 10}, graph/lexical ${topK * 2})`);

  if (target) {
    const rank = order.findIndex(c => members.includes(c.text_id ?? ''));
    console.log(`\ntarget "${target}" true score-rank: ${rank < 0 ? 'ABSENT from pool' : rank + 1}`);
    if (rank > 0) {
      const above = order.slice(0, rank);
      const byWork: Record<string, number> = {};
      for (const c of above) byWork[c.text_id ?? ''] = (byWork[c.text_id ?? ''] ?? 0) + 1;
      const hoggers = Object.entries(byWork).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
      console.log(`works taking >=2 slots above it: ${hoggers.map(([w, n]) => `${w}:${n}`).join('  ') || '(none)'}`);
    }
  }

  console.log(`\ntop ${show} by pure score:`);
  order.slice(0, show).forEach((c, i) => {
    const mark = target && members.includes(c.text_id ?? '') ? ' <== TARGET' : '';
    console.log(`  ${String(i + 1).padStart(3)}. [${c.tradition}] ${c.text_id}${mark}`);
  });

  if (cap > 0) {
    // Simulate a per-work cap (per-tradition cap held at 3, matching production)
    // on this same order, to see whether the cap would lift the target into topK.
    const tc: Record<string, number> = {}, wc: Record<string, number> = {};
    const out: RetrievedChunk[] = [];
    for (const c of order) {
      if (out.length >= topK) break;
      const t = c.tradition ?? '', w = c.text_id ?? '';
      if ((tc[t] ?? 0) >= 3) continue;
      if ((wc[w] ?? 0) >= cap) continue;
      out.push(c); tc[t] = (tc[t] ?? 0) + 1; wc[w] = (wc[w] ?? 0) + 1;
    }
    const hit = target ? out.some(c => members.includes(c.text_id ?? '')) : false;
    console.log(`\nsimulated per-work cap=${cap} (per-tradition 3): target in top-${topK}? ${target ? hit : 'n/a'}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });
