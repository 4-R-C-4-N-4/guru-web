/**
 * scripts/embed-concepts.ts
 *
 * One-time (idempotent) population of concepts.embedding for semantic
 * query→concept matching (ticket d6472704). Embeds "<label>. <definition>" with
 * the same nomic-embed-text model used for chunks and queries, so the query
 * embedding already computed in the retriever can be cosine-matched against
 * concepts via pgvector.
 *
 * Requires a live local corpus + Ollama embeddings.
 * Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs) && npx tsx scripts/embed-concepts.ts
 *   npx tsx scripts/embed-concepts.ts --force   # re-embed all (e.g. definitions changed)
 */
import { query, exec } from '../src/lib/db';
import { embed } from '../src/lib/embed';

async function main() {
  const force = process.argv.includes('--force');
  const rows = await query<{ id: string; label: string; definition: string | null }>(
    `SELECT id, label, definition FROM concepts
      ${force ? '' : 'WHERE embedding IS NULL'}
      ORDER BY id`
  );
  if (rows.length === 0) {
    console.log('nothing to embed (all concepts already have embeddings; use --force to redo)');
    return;
  }
  console.log(`embedding ${rows.length} concepts...`);
  let done = 0;
  for (const c of rows) {
    // label + definition: the label alone is often a single term; the definition
    // carries the semantics a paraphrased query will match against.
    const text = c.definition ? `${c.label}. ${c.definition}` : c.label;
    const vec = await embed(text);
    await exec(`UPDATE concepts SET embedding = $1::vector WHERE id = $2`,
      [JSON.stringify(vec), c.id]);
    if (++done % 25 === 0 || done === rows.length) console.log(`  ${done}/${rows.length}`);
  }
  console.log('done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
