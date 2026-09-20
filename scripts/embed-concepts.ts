/**
 * scripts/embed-concepts.ts
 *
 * Post-corpus-load step for semantic query→concept matching (ticket d6472704).
 * Run this AFTER every corpus load: `concepts` is a corpus-schema table, and the
 * export drops/atomic-swaps the `corpus` schema, so the embedding column and its
 * values are wiped on every reload. A migration can't restore that (it would be
 * marked applied but the column is gone) — so this script owns the column
 * (idempotent ADD COLUMN, schema-qualified) and repopulates it.
 *
 * Only concepts WITH a real definition are embedded. nomic collapses bare short
 * labels (no definition) to near-constant vectors — 14 definition-less concepts
 * collapsed to 3 distinct embeddings, e.g. "Cosmic Order"/"Courtly Love"/"Dream
 * Vision" sharing one vector — which become garbage nearest-neighbors for short
 * queries. Definition-less concepts are left with a NULL embedding and skipped by
 * the semantic matcher (it filters `WHERE embedding IS NOT NULL`); they remain
 * reachable via the keyword matcher. Backfilling their definitions upstream would
 * let them rejoin the semantic leg.
 *
 * Requires a live corpus + Ollama embeddings.
 * Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs) && npx tsx scripts/embed-concepts.ts
 *   npx tsx scripts/embed-concepts.ts --force   # re-embed all (definitions changed)
 */
import { query, exec } from '../src/lib/db';
import { embed } from '../src/lib/embed';

async function main() {
  const force = process.argv.includes('--force');

  // Own the column: the corpus reload wipes it, and it lives in the corpus schema
  // (the app pool's search_path is public,corpus, but be explicit — a bare
  // `concepts` under a different search_path silently targets the wrong schema).
  await exec(`ALTER TABLE corpus.concepts ADD COLUMN IF NOT EXISTS embedding VECTOR(768)`);

  // Cleanup: definition-less concepts must never carry a (garbage) embedding.
  const cleaned = await query<{ id: string }>(
    `UPDATE corpus.concepts SET embedding = NULL
      WHERE (definition IS NULL OR btrim(definition) = '') AND embedding IS NOT NULL
      RETURNING id`
  );
  if (cleaned.length) console.log(`cleared ${cleaned.length} garbage label-only embeddings`);

  const rows = await query<{ id: string; label: string; definition: string }>(
    `SELECT id, label, definition FROM corpus.concepts
      WHERE definition IS NOT NULL AND btrim(definition) <> ''
        ${force ? '' : 'AND embedding IS NULL'}
      ORDER BY id`
  );
  const skipped = await query<{ n: string }>(
    `SELECT count(*) n FROM corpus.concepts WHERE definition IS NULL OR btrim(definition) = ''`
  );
  console.log(`embedding ${rows.length} concepts with definitions `
    + `(${skipped[0].n} definition-less concepts skipped)...`);

  let done = 0;
  for (const c of rows) {
    // Definition carries the semantics a paraphrased query matches against; the
    // label anchors it. (Definition-bearing, so no collapse.)
    const vec = await embed(`${c.label}. ${c.definition}`);
    await exec(`UPDATE corpus.concepts SET embedding = $1::vector WHERE id = $2`,
      [JSON.stringify(vec), c.id]);
    if (++done % 25 === 0 || done === rows.length) console.log(`  ${done}/${rows.length}`);
  }
  console.log('done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
