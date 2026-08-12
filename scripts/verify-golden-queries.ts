/**
 * scripts/verify-golden-queries.ts
 *
 * Author-side verifier for per-work golden query files (todo:a3bb24b5;
 * docs/golden-queries.md "verify before you ship"). Runs one or more works'
 * files through the FULL retrieve() pipeline against the live local corpus
 * and reports each assertion, so a probe that misses top-K can be honestly
 * iterated before the PR — without running the whole integration gate over
 * every work file.
 *
 * Exit code 1 if any assertion fails (usable as a loop condition).
 *
 * Requires a live local corpus + Ollama embeddings.
 * Run:
 *   npx tsx scripts/verify-golden-queries.ts <work> [<work>...]
 *   npx tsx scripts/verify-golden-queries.ts --all
 */
import 'dotenv/config';
import { join } from 'path';
import { readFileSync } from 'fs';
import { retrieve } from '../src/lib/retriever';
import { query } from '../src/lib/db';
import type { UserPreferences } from '../src/lib/types';
import {
  GOLDEN_QUERIES_DIR,
  listGoldenQueryFiles,
  validateGoldenQueriesFile,
  type GoldenQueriesFile,
} from '../src/__tests__/helpers/golden-queries';

const TOP_K = 15; // same bar as the golden gates

const PREFS: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [],
  preferredModel: null, preferredVoice: 'scholar',
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const names = args.includes('--all')
    ? listGoldenQueryFiles().map(f => f.replace(/\.json$/, ''))
    : args;
  if (names.length === 0) {
    console.error('usage: npx tsx scripts/verify-golden-queries.ts <work> [<work>...] | --all');
    process.exit(2);
  }

  let failures = 0;
  for (const work of names) {
    const path = join(GOLDEN_QUERIES_DIR, `${work}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const schemaErrors = validateGoldenQueriesFile(raw, `${work}.json`);
    if (schemaErrors.length > 0) {
      console.error(`✗ ${work}: schema invalid\n  ${schemaErrors.join('\n  ')}`);
      failures += schemaErrors.length;
      continue;
    }
    const file = raw as GoldenQueriesFile;

    const members = new Set(
      (await query<{ id: string }>(
        `SELECT unnest(member_text_ids) AS id FROM works WHERE id = $1`, [file.work],
      )).map(r => r.id),
    );
    if (members.size === 0) {
      console.error(`✗ ${work}: no corpus.works row — is the work id right?`);
      failures++;
      continue;
    }

    console.log(`\n=== ${work} (${file.tradition}, frozenEval: ${file.frozenEval}) ===`);
    for (const q of file.queries) {
      const chunks = await retrieve(q.query, PREFS, TOP_K);
      const traditions = new Set(chunks.map(c => c.tradition));

      if (q.kind === 'relevance') {
        const ok = chunks.length > 0;
        if (!ok) failures++;
        console.log(`  ${ok ? '·' : '✗'} [relevance] "${q.query}" → ${chunks.length} chunks (no assertion)`);
        continue;
      }

      const problems: string[] = [];
      for (const t of q.mustIncludeTraditions ?? []) {
        if (!traditions.has(t)) problems.push(`missing tradition ${t} (got: ${[...traditions].join(', ')})`);
      }
      if (q.mustIncludeWork && !chunks.some(c => members.has(c.text_id))) {
        problems.push(`work itself not in top-${TOP_K} (got text_ids: ${[...new Set(chunks.map(c => c.text_id))].join(', ')})`);
      }
      failures += problems.length;
      console.log(`  ${problems.length === 0 ? '✓' : '✗'} [probe] "${q.query}"${problems.length ? '\n      ' + problems.join('\n      ') : ''}`);
    }
  }

  console.log(`\n${failures === 0 ? 'all assertions hold' : `${failures} assertion(s) failing`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(2); });
