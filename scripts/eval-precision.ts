/**
 * scripts/eval-precision.ts
 *
 * LLM-judged retrieval precision (todo:59060e24). The sweep's head-stability is a
 * churn proxy, not relevance — it can't tell "surfaced mesopotamia for Tiamat"
 * (good) from "injected rare junk into an unrelated query" (bad). This judges
 * actual relevance: for each query × config, retrieve top-K and ask an LLM to
 * label each passage relevant/not, then report precision@K.
 *
 * Bounded: small judged set × the configs that matter, one batched call per
 * (config, query). Non-deterministic (LLM) and costs a little OpenRouter spend —
 * a manual experiment tool, not a CI gate.
 *
 * Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL|OPENROUTER_API_KEY)=' .env | xargs) \
 *   npx tsx scripts/eval-precision.ts
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

interface Config { name: string; div: 'live' | 'fixed'; mult: number }
const CONFIGS: Config[] = [
  { name: 'live x2  (baseline)', div: 'live', mult: 2 },
  { name: 'live x10 (wide)', div: 'live', mult: 10 },
  { name: 'fixed x10 (decoupled)', div: 'fixed', mult: 10 },
];

const QUERIES = [
  'Tiamat and the Babylonian creation',
  'Ahura Mazda and the Gathas',
  'the Diamond Sutra and emptiness',
  'cosmology',
  'union with the divine',
  'the One and emanation from the Nous',
  'the tao and the way of wu wei',
];

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

/** Ask the LLM for a 0/1 relevance label per passage; returns precision@K. */
async function judge(query: string, passages: string[]): Promise<number> {
  const numbered = passages.map((p, i) => `[${i + 1}] ${p.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n\n');
  const res = await client.chat.completions.create({
    model: JUDGE_MODEL,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a strict relevance judge for a comparative-religion / mysticism retrieval system. ' +
          'For each numbered passage, decide whether it is genuinely relevant and useful for answering the ' +
          "user's query. Reply with ONLY a JSON array of 0/1 (1 = relevant), one entry per passage, in order. No prose.",
      },
      { role: 'user', content: `QUERY: ${query}\n\nPASSAGES:\n${numbered}` },
    ],
  });
  const text = res.choices[0]?.message?.content ?? '';
  const m = text.match(/\[[\s\S]*?\]/);
  if (!m) return NaN;
  const labels = JSON.parse(m[0]) as number[];
  return labels.filter(x => x === 1).length / labels.length;
}

async function main() {
  console.log(`\n=== LLM-JUDGED PRECISION@${TOPK} (judge=${JUDGE_MODEL}) ===\n`);
  const grid: Record<string, Record<string, number>> = {};

  for (const cfg of CONFIGS) {
    process.env.RETRIEVAL_POOL_MULT = String(cfg.mult);
    process.env.RETRIEVAL_DIVERSITY = cfg.div;
    grid[cfg.name] = {};
    for (const q of QUERIES) {
      const chunks = await retrieve(q, PREFS, TOPK);
      const p = await judge(q, chunks.map(c => c.body));
      grid[cfg.name][q] = p;
    }
  }

  // Per-query table + per-config mean.
  const header = ['query'.padEnd(40), ...CONFIGS.map(c => c.name.padStart(22))].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const q of QUERIES) {
    console.log([q.slice(0, 40).padEnd(40), ...CONFIGS.map(c => grid[c.name][q].toFixed(2).padStart(22))].join(' '));
  }
  console.log('-'.repeat(header.length));
  const means = CONFIGS.map(c => {
    const vals = QUERIES.map(q => grid[c.name][q]).filter(v => !Number.isNaN(v));
    return (vals.reduce((a, b) => a + b, 0) / vals.length);
  });
  console.log(['MEAN precision@K'.padEnd(40), ...means.map(m => m.toFixed(2).padStart(22))].join(' '));
  console.log('');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
