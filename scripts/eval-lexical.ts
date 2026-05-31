/**
 * scripts/eval-lexical.ts
 *
 * LEXICAL_WEIGHT sweep for the hybrid retrieval leg (todo:3fc23534). Round 3 of
 * the tuning experiment proved the precision ceiling is dense-retrieval hubness:
 * proper-noun / entity queries wash out (Ahura Mazda → 0 of 152 zoroastrian
 * chunks). The lexical leg (RETRIEVAL_LEXICAL) rescues them; this sweeps its
 * weight on the production-default config (live ×2) to find where it helps the
 * entity queries WITHOUT hurting the conceptual queries the dense leg already
 * nails (cosmology 0.9).
 *
 * Weight 0 = pure vector+graph baseline (leg runs, contributes nothing), so the
 * first column is the apples-to-apples control. Also reports, for the two entity
 * queries, how many of the on-target tradition's chunks reach the top-10.
 *
 * Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL|OPENROUTER_API_KEY)=' .env | xargs) \
 *   npx tsx scripts/eval-lexical.ts
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
const WEIGHTS = [0, 0.5, 1.0, 1.5, 2.5];

const QUERIES = [
  'Tiamat and the Babylonian creation',
  'Ahura Mazda and the Gathas',
  'the Diamond Sutra and emptiness',
  'cosmology',
  'union with the divine',
  'the One and emanation from the Nous',
  'the tao and the way of wu wei',
];

// Entity queries whose on-target tradition the dense leg missed entirely (R3).
const TARGET_TRADITION: Record<string, string> = {
  'Tiamat and the Babylonian creation': 'mesopotamian',
  'Ahura Mazda and the Gathas': 'zoroastrianism',
};

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

async function judge(query: string, passages: string[]): Promise<number> {
  if (passages.length === 0) return NaN;
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
  // Fix the production-default config; sweep only the lexical weight.
  process.env.RETRIEVAL_POOL_MULT = '2';
  delete process.env.RETRIEVAL_DIVERSITY; // 'live'
  process.env.RETRIEVAL_LEXICAL = '1';

  console.log(`\n=== LEXICAL_WEIGHT SWEEP — precision@${TOPK} (config live×2, judge=${JUDGE_MODEL}) ===\n`);
  const grid: Record<number, Record<string, number>> = {};
  const targetHits: Record<number, Record<string, number>> = {};

  for (const w of WEIGHTS) {
    process.env.RETRIEVAL_LEXICAL_WEIGHT = String(w);
    grid[w] = {};
    targetHits[w] = {};
    for (const q of QUERIES) {
      const chunks = await retrieve(q, PREFS, TOPK);
      grid[w][q] = await judge(q, chunks.map(c => c.body));
      const target = TARGET_TRADITION[q];
      if (target) targetHits[w][q] = chunks.filter(c => c.tradition === target).length;
    }
  }

  const head = ['query'.padEnd(40), ...WEIGHTS.map(w => `w=${w}`.padStart(8))].join(' ');
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const q of QUERIES) {
    console.log([q.slice(0, 40).padEnd(40), ...WEIGHTS.map(w => grid[w][q].toFixed(2).padStart(8))].join(' '));
  }
  console.log('-'.repeat(head.length));
  const means = WEIGHTS.map(w => {
    const vals = QUERIES.map(q => grid[w][q]).filter(v => !Number.isNaN(v));
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  console.log(['MEAN precision@K'.padEnd(40), ...means.map(m => m.toFixed(2).padStart(8))].join(' '));

  console.log('\n--- on-target tradition chunks in top-10 (entity queries) ---');
  for (const q of Object.keys(TARGET_TRADITION)) {
    console.log([`${TARGET_TRADITION[q]} (${q.slice(0, 20)})`.padEnd(40),
      ...WEIGHTS.map(w => String(targetHits[w][q]).padStart(8))].join(' '));
  }
  console.log('');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
