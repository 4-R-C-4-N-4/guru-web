/**
 * scripts/eval-graphweight.ts
 *
 * RETRIEVAL_GRAPH_WEIGHT sweep (todo:dafd05d2). With concept_aliases populated
 * (corpus v30), the graph leg finally surfaces transliteration content no other
 * leg reaches (ohrmazd→Ahura Mazda Principle, etc.) — but at the default 0.3
 * those chunks lose top-K slots to vector hubs (alias-query mean was 0.10 vs
 * 0.05 graph-off; real but small). This sweeps the graph weight, exactly as
 * eval-lexical.ts swept LEXICAL_WEIGHT.
 *
 * Reports TWO sets so we don't help alias queries by wrecking conceptual ones:
 *   - ALIAS    : phrased in alias vocabulary; graph leg is the only way in.
 *   - STANDARD : the Round 3-5 set (mostly label/lexical hits); the guard rail.
 *
 * All in the shipped cell: lexical on w=1.0, pool ×10, regex matcher. Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL|OPENROUTER_API_KEY)=' .env | xargs) \
 *   npx tsx scripts/eval-graphweight.ts
 */
import OpenAI from 'openai';
import { retrieve } from '../src/lib/retriever';
import type { UserPreferences } from '../src/lib/types';

const PREFS: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [], preferredModel: null, preferredVoice: 'scholar',
};
const TOPK = 10;
const JUDGE_MODEL = 'deepseek/deepseek-v4-pro';
const WEIGHTS = [0.3, 0.5, 0.7, 1.0, 1.5];

const ALIAS = ['ohrmazd and ahriman', 'the sefirot and ayn sof', 'gnosis and the yaldabaoth', 'reincarnation and transmigration'];
const STANDARD = ['Tiamat and the Babylonian creation', 'cosmology', 'union with the divine', 'the One and emanation from the Nous', 'the tao and the way of wu wei'];
const SETS: Record<string, string[]> = { ALIAS, STANDARD };

const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY!, baseURL: 'https://openrouter.ai/api/v1' });

async function judge(query: string, passages: string[]): Promise<number> {
  if (!passages.length) return NaN;
  const numbered = passages.map((p, i) => `[${i + 1}] ${p.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n\n');
  const res = await client.chat.completions.create({
    model: JUDGE_MODEL, temperature: 0,
    messages: [
      { role: 'system', content:
          'You are a strict relevance judge for a comparative-religion / mysticism retrieval system. ' +
          'For each numbered passage, decide whether it is genuinely relevant and useful for answering the ' +
          "query. Reply with ONLY a JSON array of 0/1 (1 = relevant), one per passage, in order. No prose." },
      { role: 'user', content: `QUERY: ${query}\n\nPASSAGES:\n${numbered}` },
    ],
  });
  const m = (res.choices[0]?.message?.content ?? '').match(/\[[\s\S]*?\]/);
  if (!m) return NaN;
  const labels = JSON.parse(m[0]) as number[];
  return labels.filter(x => x === 1).length / labels.length;
}

const mean = (xs: number[]) => { const v = xs.filter(x => !Number.isNaN(x)); return v.reduce((a, b) => a + b, 0) / v.length; };

async function main() {
  process.env.RETRIEVAL_LEXICAL = '1';
  process.env.RETRIEVAL_LEXICAL_WEIGHT = '1.0';
  process.env.RETRIEVAL_POOL_MULT = '10';
  process.env.GRAPH_MATCH_MODE = 'regex';

  console.log(`\n=== RETRIEVAL_GRAPH_WEIGHT sweep — precision@${TOPK} (lexical w=1.0 pool×10 regex, corpus v30, judge=${JUDGE_MODEL}) ===\n`);
  const means: Record<string, Record<number, number>> = { ALIAS: {}, STANDARD: {} };
  for (const w of WEIGHTS) {
    process.env.RETRIEVAL_GRAPH_WEIGHT = String(w);
    for (const set of Object.keys(SETS)) {
      const ps: number[] = [];
      for (const q of SETS[set]) {
        const chunks = await retrieve(q, PREFS, TOPK);
        ps.push(await judge(q, chunks.map(c => c.body)));
      }
      means[set][w] = mean(ps);
    }
  }

  const head = ['set'.padEnd(12), ...WEIGHTS.map(w => `w=${w}`.padStart(8))].join(' ');
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const set of ['ALIAS', 'STANDARD']) {
    console.log([set.padEnd(12), ...WEIGHTS.map(w => means[set][w].toFixed(2).padStart(8))].join(' '));
  }
  console.log('\n(w=0.3 is the current shipped default — the control column)\n');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
