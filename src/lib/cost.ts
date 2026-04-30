/**
 * src/lib/cost.ts
 *
 * Cost computation for LLM requests (todo:92ebb9fd).
 *
 * - getPricing(modelId, at): pulls the row from model_pricing whose
 *   [effective_from, effective_to) range contains `at`. Returns null
 *   if no such row exists; computeCost throws in that case.
 * - computeCost(args): given token counts, returns USD cost and the
 *   pricing row used. Counts cached tokens at cached_input_price when
 *   the model exposes one, otherwise falls back to input_price.
 *
 * Cost is intended to be computed once at write time (in /api/query)
 * and stored in queries.cost_usd; never recomputed on read.
 */

import { one } from './db';

export interface ModelPricing {
  model_id: string;
  input_price_per_mtok: number;
  output_price_per_mtok: number;
  cached_input_price_per_mtok: number | null;
  effective_from: Date;
  effective_to: Date | null;
}

interface PricingRow {
  model_id: string;
  input_price_per_mtok: string;
  output_price_per_mtok: string;
  cached_input_price_per_mtok: string | null;
  effective_from: Date;
  effective_to: Date | null;
}

/**
 * Pull the pricing row in effect at `at` (defaults to now). null if
 * no row covers that timestamp — caller decides whether to throw.
 */
export async function getPricing(
  modelId: string,
  at: Date = new Date(),
): Promise<ModelPricing | null> {
  const row = await one<PricingRow>(
    `SELECT model_id, input_price_per_mtok, output_price_per_mtok,
            cached_input_price_per_mtok, effective_from, effective_to
     FROM model_pricing
     WHERE model_id = $1
       AND effective_from <= $2
       AND (effective_to IS NULL OR effective_to > $2)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [modelId, at],
  );
  if (!row) return null;
  return {
    model_id: row.model_id,
    input_price_per_mtok:        Number(row.input_price_per_mtok),
    output_price_per_mtok:       Number(row.output_price_per_mtok),
    cached_input_price_per_mtok: row.cached_input_price_per_mtok === null
      ? null
      : Number(row.cached_input_price_per_mtok),
    effective_from: row.effective_from,
    effective_to:   row.effective_to,
  };
}

/**
 * Compute USD cost for a single LLM call. Throws if no pricing row
 * exists at `at` — silently returning 0 would under-charge and is
 * never the right answer.
 *
 * Formula:
 *   fresh_input = inputTokens - cachedInputTokens
 *   cost = fresh_input * input_price / 1e6
 *        + cachedInputTokens * (cached_input_price ?? input_price) / 1e6
 *        + outputTokens * output_price / 1e6
 */
export async function computeCost(args: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  at?: Date;
}): Promise<{ cost_usd: number; pricing: ModelPricing }> {
  const {
    modelId,
    inputTokens,
    outputTokens,
    cachedInputTokens = 0,
    at = new Date(),
  } = args;

  const pricing = await getPricing(modelId, at);
  if (!pricing) {
    throw new Error(
      `No model_pricing row for ${modelId} at ${at.toISOString()} — ` +
      `seed via 'npm run sync-pricing' before calling computeCost.`,
    );
  }

  const fresh = inputTokens - cachedInputTokens;
  if (fresh < 0) {
    throw new Error(
      `cachedInputTokens (${cachedInputTokens}) exceeds inputTokens (${inputTokens}) — ` +
      `provider response shape is unexpected.`,
    );
  }

  const cachedRate = pricing.cached_input_price_per_mtok ?? pricing.input_price_per_mtok;
  const cost_usd =
    (fresh              * pricing.input_price_per_mtok  / 1e6) +
    (cachedInputTokens  * cachedRate                    / 1e6) +
    (outputTokens       * pricing.output_price_per_mtok / 1e6);

  return { cost_usd, pricing };
}
