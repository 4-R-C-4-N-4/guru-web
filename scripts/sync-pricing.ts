/**
 * scripts/sync-pricing.ts
 *
 * Sync model_pricing from OpenRouter (https://openrouter.ai/api/v1/models).
 * Operator-run; idempotent; price changes append a new row and bump the
 * previous row's effective_to. todo:8832ce67.
 *
 * Usage:
 *   npx tsx scripts/sync-pricing.ts
 *   npm run sync-pricing
 *
 * If OpenRouter is unreachable, falls back to FALLBACK_PRICING values
 * committed below — accurate as of 2026-04-30; bump them when the
 * upstream prices change AND remote sync isn't an option.
 */

import { Pool, type PoolClient } from 'pg';

// ── Allowlist ────────────────────────────────────────────────────────
// Only sync the models we actually route to (per src/lib/model.ts).
// Adding a new tier? Update both files in the same PR.
//
// `srcId`        — what we use everywhere internally (queries.model_used,
//                  model_pricing.model_id, src/lib/model.ts MODELS).
// `openrouterId` — what OpenRouter's /api/v1/models endpoint advertises.
//
// They diverge for Sonnet: OpenRouter's listing uses the dotted form
// 'anthropic/claude-sonnet-4.5' while we (and the completion API,
// which accepts both) use the hyphenated 'anthropic/claude-sonnet-4-5'.
// extractPricing looks up by openrouterId and stores under srcId so
// model_pricing.model_id always matches queries.model_used.  todo:dbeee9a6.
export const MODELS_TO_SYNC: ReadonlyArray<{ srcId: string; openrouterId: string }> = [
  { srcId: 'deepseek/deepseek-chat',        openrouterId: 'deepseek/deepseek-chat' },
  { srcId: 'anthropic/claude-sonnet-4-5',   openrouterId: 'anthropic/claude-sonnet-4.5' },
] as const;

// Backwards-compat for places that just want the list of internal ids.
const KNOWN_MODELS = MODELS_TO_SYNC.map(m => m.srcId);

export interface ModelPrice {
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok: number | null; // null = model doesn't cache
}

// Fallback when OpenRouter is unreachable — accurate as of 2026-04-30.
// Keep in sync with provider docs; small periodic drift is fine, the
// next successful network sync will correct it.
const FALLBACK_PRICING: Record<string, ModelPrice> = {
  'deepseek/deepseek-chat': {
    input_per_mtok: 0.14,
    output_per_mtok: 0.28,
    cached_input_per_mtok: null,
  },
  'anthropic/claude-sonnet-4-5': {
    input_per_mtok: 3.0,
    output_per_mtok: 15.0,
    cached_input_per_mtok: 0.30,
  },
};

interface OpenRouterModel {
  id: string;
  pricing: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
  };
}

// ── Pure helpers (exported for tests) ────────────────────────────────

/**
 * Extract per-Mtok USD pricing for our allowlist from OpenRouter's
 * response. OpenRouter returns per-token decimal strings; multiply by
 * 1e6 to get per-Mtok.
 *
 * Lookup is keyed by openrouterId; the result is stored under srcId
 * so model_pricing.model_id matches queries.model_used.
 */
export function extractPricing(
  response: { data: OpenRouterModel[] },
  models: ReadonlyArray<{ srcId: string; openrouterId: string }>,
): Record<string, ModelPrice> {
  const byOpenRouterId = new Map(response.data.map(m => [m.id, m]));
  const out: Record<string, ModelPrice> = {};
  for (const { srcId, openrouterId } of models) {
    const m = byOpenRouterId.get(openrouterId);
    if (!m || !m.pricing?.prompt || !m.pricing?.completion) continue;
    out[srcId] = {
      input_per_mtok:        parseFloat(m.pricing.prompt) * 1e6,
      output_per_mtok:       parseFloat(m.pricing.completion) * 1e6,
      cached_input_per_mtok: m.pricing.input_cache_read
        ? parseFloat(m.pricing.input_cache_read) * 1e6
        : null,
    };
  }
  return out;
}

/**
 * Compare two pricings; both null and same-number cached fields count
 * as matching. Used to short-circuit no-op syncs.
 */
export function pricingMatches(a: ModelPrice, b: ModelPrice): boolean {
  if (a.input_per_mtok  !== b.input_per_mtok)  return false;
  if (a.output_per_mtok !== b.output_per_mtok) return false;
  // null === null counts as matching; one null one number does not.
  if (a.cached_input_per_mtok === null && b.cached_input_per_mtok === null) return true;
  return a.cached_input_per_mtok === b.cached_input_per_mtok;
}

// ── Network ──────────────────────────────────────────────────────────

async function fetchPricingFromOpenRouter(): Promise<Record<string, ModelPrice> | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[sync-pricing] OpenRouter returned HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { data: OpenRouterModel[] };
    return extractPricing(json, MODELS_TO_SYNC);
  } catch (err) {
    console.warn('[sync-pricing] OpenRouter fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── DB ───────────────────────────────────────────────────────────────

async function syncOne(
  client: PoolClient,
  modelId: string,
  next: ModelPrice,
): Promise<'unchanged' | 'seeded' | 'updated'> {
  const cur = await client.query<{
    input_price_per_mtok: string;
    output_price_per_mtok: string;
    cached_input_price_per_mtok: string | null;
  }>(
    `SELECT input_price_per_mtok, output_price_per_mtok, cached_input_price_per_mtok
     FROM model_pricing
     WHERE model_id = $1 AND effective_to IS NULL`,
    [modelId],
  );

  const isSeed = cur.rows.length === 0;

  if (!isSeed) {
    const r = cur.rows[0]!;
    const current: ModelPrice = {
      input_per_mtok:        Number(r.input_price_per_mtok),
      output_per_mtok:       Number(r.output_price_per_mtok),
      cached_input_per_mtok: r.cached_input_price_per_mtok === null ? null : Number(r.cached_input_price_per_mtok),
    };
    if (pricingMatches(current, next)) return 'unchanged';
  }

  await client.query('BEGIN');
  try {
    if (!isSeed) {
      await client.query(
        `UPDATE model_pricing SET effective_to = now()
         WHERE model_id = $1 AND effective_to IS NULL`,
        [modelId],
      );
    }
    await client.query(
      `INSERT INTO model_pricing
         (model_id, input_price_per_mtok, output_price_per_mtok,
          cached_input_price_per_mtok, effective_from, effective_to)
       VALUES ($1, $2, $3, $4, now(), NULL)`,
      [modelId, next.input_per_mtok, next.output_per_mtok, next.cached_input_per_mtok],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return isSeed ? 'seeded' : 'updated';
}

// ── Entrypoint ───────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const remote = await fetchPricingFromOpenRouter();
  const pricing = remote ?? FALLBACK_PRICING;
  if (!remote) console.log('[sync-pricing] using committed fallback values');

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    for (const modelId of KNOWN_MODELS) {
      const next = pricing[modelId];
      if (!next) {
        console.warn(`[sync-pricing] ${modelId}: no pricing available, skipping`);
        continue;
      }
      const result = await syncOne(client, modelId, next);
      console.log(`[sync-pricing] ${modelId}: ${result}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// Only run main when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('sync-pricing failed:', err);
    process.exit(1);
  });
}
