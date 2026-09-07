/**
 * scripts/golden-check.ts — post-corpus-load staging smoke-test.
 *
 * NOT the golden GATE. `src/__tests__/golden-queries.test.ts`
 * (INTEGRATION_TEST=1) is the ~14-min retrieval-QUALITY gate: it scores a
 * frozen 27-query gold set and asserts exact pass counts, guarding the
 * retriever CODE against a ranking regression. This script guards the corpus
 * LOAD instead — a fast, coarse, run-by-hand check for the moment right after
 * you `zcat export/guru-corpus.sql.gz | psql` a fresh export into the docker
 * corpus and before pushing it to prod. It answers one question: did the
 * atomic corpus_new→corpus swap land the NEW text and drop NOTHING?
 *
 * It exercises the REAL retriever (src/lib/retriever.ts) against docker
 * Postgres via the same embed() → Ollama → vector/graph/rerank path the app
 * serves, bypassing only Clerk auth + LLM answer generation. The assertion is
 * deliberately blunt — "does at least one expected text_id appear in top-K" —
 * because a load either surfaces a text or it doesn't; scoring is the gate's job.
 *
 * Prereqs (same as the gate): docker Postgres with the corpus loaded + Ollama
 * with nomic-embed-text. See docs/retrieval-golden-gap-investigation.md §9.1.
 *
 * Usage:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs)
 *   # regression spread only (nothing dropped by the load):
 *   npx tsx scripts/golden-check.ts
 *   # plus a NEW text the load is supposed to introduce (repeatable):
 *   npx tsx scripts/golden-check.ts \
 *     "blavatsky-sd=What does the Secret Doctrine teach about the seven races of humanity?" \
 *     "blavatsky-sd=How does the Secret Doctrine describe manvantara and pralaya?"
 *
 * Each extra arg is `<text_id>=<query>`: the probe passes if that text_id
 * appears in the top-K. Exit 0 = all pass, 1 = a probe missed, 2 = crash.
 */
import 'dotenv/config';
import { retrieve } from '../src/lib/retriever';
import type { UserPreferences } from '../src/lib/types';

const PREFS: UserPreferences = {
  scopeMode: 'all',
  blockedTraditions: [],
  blockedTexts: [],
  whitelistedTraditions: [],
  whitelistedTexts: [],
  preferredModel: null,
  preferredVoice: 'scholar',
};

const TOP_K = 15;

interface Probe {
  label: string;
  query: string;
  expect: string[]; // pass if ANY of these text_ids surfaces in top-K
}

// Regression spread: a stable cross-tradition set that should ALWAYS surface,
// whatever the load. These are load-integrity canaries (did the swap drop a
// tradition?), not quality probes — keep them broad and uncontroversial, not
// tuned to the failing edge cases the gate tracks.
const REGRESSION: Probe[] = [
  { label: 'kybalion (western_esoteric)',
    query: 'What are the seven hermetic principles of the Kybalion?',
    expect: ['kybalion'] },
  { label: 'sefer-yetzirah (jewish)',
    query: 'How does the Sefer Yetzirah describe the creation of the world through the ten sefirot and letters?',
    expect: ['sefer-yetzirah'] },
  { label: 'tao te ching (taoism)',
    query: 'What does the Tao Te Ching say about wu wei and the nature of the Tao?',
    expect: ['tao-te-ching-legge'] },
  { label: 'book of the dead (egyptian)',
    query: 'What does the Egyptian Book of the Dead say about the judgment of the soul in the Hall of Maat?',
    expect: ['egyptian-book-of-the-dead-index'] },
  { label: 'gospel of thomas (gnosticism)',
    query: 'What does the Gospel of Thomas say about the kingdom of God within?',
    expect: ['gospel-of-thomas'] },
  { label: 'corpus hermeticum (hermeticism)',
    query: 'What does the Corpus Hermeticum teach about the Nous and the nature of God?',
    expect: ['corpus-hermeticum-01'] },
];

// Parse `<text_id>=<query>` CLI args into NEW-text probes (the part that
// changes per corpus episode, so it's supplied rather than hardcoded).
function parseNewProbes(argv: string[]): Probe[] {
  return argv.map((arg) => {
    const eq = arg.indexOf('=');
    if (eq < 0) {
      console.error(`bad probe "${arg}": expected "<text_id>=<query>"`);
      process.exit(2);
    }
    const textId = arg.slice(0, eq).trim();
    const query = arg.slice(eq + 1).trim();
    return { label: `NEW: ${textId}`, query, expect: [textId] };
  });
}

async function probe(p: Probe): Promise<boolean> {
  const chunks = await retrieve(p.query, PREFS, TOP_K);
  const seen = new Set<string>();
  const surface: Record<string, number> = {};
  for (const c of chunks) {
    surface[c.tradition ?? ''] = (surface[c.tradition ?? ''] ?? 0) + 1;
    seen.add(c.text_id ?? '');
  }
  const hit = p.expect.some((e) => seen.has(e));
  console.log(`\n=== ${p.label} ===`);
  console.log(`  query: ${p.query}`);
  console.log(`  hit-expected(${p.expect.join(',')}): ${hit ? 'YES' : 'NO'}`);
  console.log(`  top traditions: ${JSON.stringify(surface)}`);
  for (const c of chunks.slice(0, 5)) {
    console.log(`    [${c.tradition}] ${c.text_name ?? c.text_id} :: ${c.section ?? ''} :: ${String(c.body ?? '').slice(0, 70)}`);
  }
  return hit;
}

async function main(): Promise<void> {
  const newProbes = parseNewProbes(process.argv.slice(2));
  const probes = [...newProbes, ...REGRESSION];
  let pass = true;
  for (const p of probes) pass = (await probe(p)) && pass;
  console.log(`\n\nRESULT: ${pass ? 'PASS — no regression, expected texts surface' : 'FAIL — check above'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('golden check crashed:', e);
  process.exit(2);
});
