/**
 * scripts/sync-pricing.ts
 *
 * Sync model_pricing from OpenRouter (https://openrouter.ai/api/v1/models).
 * Operator-run; idempotent; price changes append a new row and bump the
 * previous row's effective_to.  todo:8832ce67, todo:fbd30eff.
 *
 * Usage:
 *   npx tsx scripts/sync-pricing.ts
 *   npm run sync-pricing
 *
 * What gets synced: every model whose id starts with one of the providers
 * in PROVIDER_ALLOWLIST.  Pre-loading the catalog this way means a new
 * routed model (per-tier or per-user) finds an existing pricing row
 * without operator intervention — the next scheduled sync would have
 * caught the new model anyway, but pre-loading gets us there in one
 * step.
 *
 * If OpenRouter is unreachable, falls back to FALLBACK_PRICING values
 * for the models we actively route to (so the live path keeps working
 * if a sync runs during an OpenRouter outage). The rest of the catalog
 * is best-effort via OpenRouter.
 */

import { Pool, type PoolClient } from 'pg';
import { FALLBACK_PRICING, type ModelPrice } from '../src/lib/fallback-pricing';
import { CURATED_MODELS } from '../src/lib/curated-models';

// ── Provider allowlist ──────────────────────────────────────────────
// Ids are matched on the prefix before '/'.  Curated to frontier-model
// providers; experimental/long-tail providers are intentionally skipped
// to keep model_pricing focused.  Add lines here when you want a new
// provider's catalog tracked.
const PROVIDER_ALLOWLIST = [
  'anthropic',
  'openai',
  'x-ai',          // Grok
  'deepseek',
  'google',        // Gemini
  'meta-llama',    // Llama
  'mistralai',
  'qwen',
] as const;

// FALLBACK_PRICING + ModelPrice moved to src/lib/fallback-pricing.ts
// so client-side code (the picker, the chat-view) can import it
// without pulling in `pg` from this file. Re-export here so existing
// `npx tsx scripts/sync-pricing.ts` consumers and tests that still
// import from this path keep working.
export { FALLBACK_PRICING, type ModelPrice };

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
 * Extract per-Mtok USD pricing from OpenRouter for every model whose id
 * starts with one of the allowed provider prefixes.  OpenRouter prices
 * are per-token decimal strings; multiply by 1e6 to get per-Mtok.
 */
export function extractPricing(
  response: { data: OpenRouterModel[] },
  providers: ReadonlyArray<string>,
): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const m of response.data) {
    const provider = m.id.split('/', 1)[0];
    if (!providers.includes(provider)) continue;
    if (!m.pricing?.prompt || !m.pricing?.completion) continue;
    out[m.id] = {
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
 * Find curated picker entries whose OpenRouter id is missing from a
 * live /api/v1/models response. Returned as `{slug, id}` pairs so the
 * caller can render a clear warning. Pure (no IO) so it can be unit
 * tested with a mocked response. Spec: todo:bcb7ea04.
 */
export function findMissingCuratedIds(
  remote: Record<string, unknown>,
  curated: Readonly<Record<string, string>>,
): Array<{ slug: string; id: string }> {
  return Object.entries(curated)
    .filter(([, id]) => !(id in remote))
    .map(([slug, id]) => ({ slug, id }));
}

/**
 * Compare two pricings; both null and same-number cached fields count
 * as matching.  Used to short-circuit no-op syncs.
 */
export function pricingMatches(a: ModelPrice, b: ModelPrice): boolean {
  if (a.input_per_mtok  !== b.input_per_mtok)  return false;
  if (a.output_per_mtok !== b.output_per_mtok) return false;
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
    return extractPricing(json, PROVIDER_ALLOWLIST);
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
  if (!remote) console.log('[sync-pricing] using committed fallback values (routed models only)');

  // Drift guard for the curated picker (todo:bcb7ea04). If a remote
  // fetch succeeded, every CURATED_MODELS id MUST appear in it; if
  // one doesn't, the picker will route to a model OpenRouter has
  // since renamed/removed — every Pro user who selects that option
  // gets a 500. Log loudly so the operator sees it in the daily
  // sync-pricing.timer journal output. We don't exit non-zero
  // because FALLBACK_PRICING still seeds a row, so paid usage
  // continues at the last-known rate; the operator just needs to
  // bump CURATED_MODELS.
  if (remote) {
    const missing = findMissingCuratedIds(remote, CURATED_MODELS);
    if (missing.length > 0) {
      console.warn(
        `[sync-pricing] WARN: curated id(s) not present in OpenRouter response — picker will 500 if selected:\n` +
        missing.map(m => `  ${m.slug} → ${m.id}`).join('\n'),
      );
    }
  }

  const ids = Object.keys(pricing).sort();
  console.log(`[sync-pricing] ${ids.length} model(s) in scope`);

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const counts = { unchanged: 0, seeded: 0, updated: 0 };
  try {
    for (const modelId of ids) {
      const next = pricing[modelId]!;
      try {
        const result = await syncOne(client, modelId, next);
        counts[result]++;
        if (result !== 'unchanged') {
          console.log(`[sync-pricing] ${modelId}: ${result}`);
        }
      } catch (err) {
        console.warn(`[sync-pricing] ${modelId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(
    `[sync-pricing] done: seeded=${counts.seeded} updated=${counts.updated} unchanged=${counts.unchanged}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('sync-pricing failed:', err);
    process.exit(1);
  });
}
