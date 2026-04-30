/**
 * scripts/backfill-cost.ts
 *
 * One-shot backfill of queries.cost_usd for rows that pre-date cost
 * tracking (todo:720e15fa).  Computes cost from model_used +
 * input_tokens + output_tokens + the pricing in effect at created_at.
 *
 * Idempotent — only touches rows where cost_usd IS NULL.  Re-running
 * after a successful pass is a no-op.
 *
 * Usage:
 *   npx tsx scripts/backfill-cost.ts
 *   npm run backfill-cost
 *
 * Limitation: cached_input_tokens isn't recoverable for historical
 * rows (we never logged it pre-todo:7c8fdae7).  Backfill assumes 0,
 * so cost is slightly over-estimated for any historical Sonnet
 * messages that had cache hits.  The two existing Sonnet rows on
 * prod were both early-tier (no cache use expected); error is
 * negligible.  Verify after with:
 *
 *   SELECT model_used, ROUND(SUM(cost_usd)::numeric, 4)
 *   FROM queries WHERE cost_usd IS NOT NULL
 *   GROUP BY model_used;
 *
 * The total should match OpenRouter's reported spend within a couple
 * of cents.
 */

import { Pool } from 'pg';

import { computeCost } from '../src/lib/cost';

interface BackfillRow {
  id: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  created_at: Date;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url });

  // Patch the global db module so src/lib/cost.ts (which imports `one`
  // from src/lib/db) can run against this pool. cost.ts doesn't take a
  // pool argument, so we rely on the pool wired up there. In production
  // (the Next.js process) this is automatic; here we're outside Next so
  // the lazy pool in src/lib/db will use DATABASE_URL itself.

  console.log('[backfill-cost] scanning queries with NULL cost_usd…');
  const { rows } = await pool.query<BackfillRow>(
    `SELECT id, model_used, input_tokens, output_tokens, created_at
     FROM queries
     WHERE cost_usd IS NULL
       AND model_used IS NOT NULL
       AND input_tokens IS NOT NULL
       AND output_tokens IS NOT NULL
     ORDER BY created_at ASC`,
  );
  console.log(`[backfill-cost] ${rows.length} row(s) to process`);

  if (rows.length === 0) {
    await pool.end();
    return;
  }

  let updated = 0;
  let skipped = 0;
  let totalUsd = 0;

  for (const r of rows) {
    try {
      const { cost_usd } = await computeCost({
        modelId: r.model_used,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cachedInputTokens: 0,
        at: r.created_at,
      });
      await pool.query(
        `UPDATE queries SET cost_usd = $1 WHERE id = $2`,
        [cost_usd, r.id],
      );
      updated++;
      totalUsd += cost_usd;
      console.log(
        `  → ${r.id} ${r.model_used.padEnd(28)} ` +
        `in=${r.input_tokens} out=${r.output_tokens} ` +
        `cost=$${cost_usd.toFixed(6)}`,
      );
    } catch (err) {
      // Most likely cause: model_pricing has no row for this model_used
      // (e.g., migrated off the model and pricing was never seeded).
      // Skip rather than abort — operator decides whether to seed and re-run.
      skipped++;
      console.warn(
        `  ! ${r.id} ${r.model_used}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(
    `[backfill-cost] done: updated=${updated} skipped=${skipped} ` +
    `total=$${totalUsd.toFixed(4)}`,
  );
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('backfill-cost failed:', err);
    process.exit(1);
  });
}
