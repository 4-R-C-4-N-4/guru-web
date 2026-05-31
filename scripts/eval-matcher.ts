/**
 * scripts/eval-matcher.ts
 *
 * Does graph-leg matcher quality move precision@10? (todo:72f1334e)
 *
 * Two questions:
 *   1. Precision@10 across three graph-leg variants, in the recommended shipped
 *      cell (lexical on, w=1.0, pool ×10): LIKE (current) vs regex (word-boundary)
 *      vs OFF. Tells us whether the graph leg / matcher precision even matters
 *      now that the lexical leg is the workhorse.
 *   2. Structural (no LLM): how many concept expansions LIKE produces that regex
 *      drops, on queries chosen to trigger substring bleed (art⊂tripARTite,
 *      man⊂eMANation, age⊂marriAGE). Quantifies the noise regex removes even if
 *      the standard query set doesn't exercise it.
 *
 * Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL|OPENROUTER_API_KEY)=' .env | xargs) \
 *   npx tsx scripts/eval-matcher.ts
 */
import OpenAI from 'openai';
import { retrieve } from '../src/lib/retriever';
import { extractConcepts } from '../src/lib/graph';
import type { UserPreferences } from '../src/lib/types';

const PREFS: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [], preferredModel: null, preferredVoice: 'scholar',
};

const TOPK = 10;
const JUDGE_MODEL = 'deepseek/deepseek-v4-pro';

const QUERIES = [
  'Tiamat and the Babylonian creation',
  'Ahura Mazda and the Gathas',
  'the Diamond Sutra and emptiness',
  'cosmology',
  'union with the divine',
  'the One and emanation from the Nous',
  'the tao and the way of wu wei',
];

// Queries built to trigger LIKE substring bleed (structural probe, no judging).
const BLEED_QUERIES = ['the art of meditation', 'the nature of man', 'coming of age'];

interface Variant { name: string; env: Record<string, string> }
const VARIANTS: Variant[] = [
  { name: 'graph LIKE (current)', env: { GRAPH_LEG: 'on', GRAPH_MATCH_MODE: 'like' } },
  { name: 'graph regex', env: { GRAPH_LEG: 'on', GRAPH_MATCH_MODE: 'regex' } },
  { name: 'graph OFF', env: { GRAPH_LEG: 'off', GRAPH_MATCH_MODE: 'like' } },
];

const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY!, baseURL: 'https://openrouter.ai/api/v1' });

async function judge(query: string, passages: string[]): Promise<number> {
  if (passages.length === 0) return NaN;
  const numbered = passages.map((p, i) => `[${i + 1}] ${p.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n\n');
  const res = await client.chat.completions.create({
    model: JUDGE_MODEL, temperature: 0,
    messages: [
      { role: 'system', content:
          'You are a strict relevance judge for a comparative-religion / mysticism retrieval system. ' +
          'For each numbered passage, decide whether it is genuinely relevant and useful for answering the ' +
          "user's query. Reply with ONLY a JSON array of 0/1 (1 = relevant), one entry per passage, in order. No prose." },
      { role: 'user', content: `QUERY: ${query}\n\nPASSAGES:\n${numbered}` },
    ],
  });
  const m = (res.choices[0]?.message?.content ?? '').match(/\[[\s\S]*?\]/);
  if (!m) return NaN;
  const labels = JSON.parse(m[0]) as number[];
  return labels.filter(x => x === 1).length / labels.length;
}

async function main() {
  // Fix the recommended shipped cell; vary only the graph leg.
  process.env.RETRIEVAL_LEXICAL = '1';
  process.env.RETRIEVAL_LEXICAL_WEIGHT = '1.0';
  process.env.RETRIEVAL_POOL_MULT = '10';

  console.log(`\n=== GRAPH-LEG MATCHER — precision@${TOPK} (lexical on w=1.0 pool×10, judge=${JUDGE_MODEL}) ===\n`);
  const grid: Record<string, Record<string, number>> = {};
  for (const v of VARIANTS) {
    Object.assign(process.env, v.env);
    grid[v.name] = {};
    for (const q of QUERIES) {
      const chunks = await retrieve(q, PREFS, TOPK);
      grid[v.name][q] = await judge(q, chunks.map(c => c.body));
    }
  }

  const head = ['query'.padEnd(40), ...VARIANTS.map(v => v.name.padStart(22))].join(' ');
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const q of QUERIES) {
    console.log([q.slice(0, 40).padEnd(40), ...VARIANTS.map(v => grid[v.name][q].toFixed(2).padStart(22))].join(' '));
  }
  console.log('-'.repeat(head.length));
  const means = VARIANTS.map(v => {
    const vals = QUERIES.map(q => grid[v.name][q]).filter(x => !Number.isNaN(x));
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  console.log(['MEAN precision@K'.padEnd(40), ...means.map(m => m.toFixed(2).padStart(22))].join(' '));

  console.log('\n--- structural: concept expansions per query (LIKE vs regex), bleed-prone queries ---');
  for (const q of BLEED_QUERIES) {
    process.env.GRAPH_MATCH_MODE = 'like';
    const like = (await extractConcepts(q)).length;
    process.env.GRAPH_MATCH_MODE = 'regex';
    const rgx = (await extractConcepts(q)).length;
    console.log(`  "${q}"`.padEnd(42) + `LIKE=${like}  regex=${rgx}  (dropped ${like - rgx} spurious)`);
  }
  console.log('');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
