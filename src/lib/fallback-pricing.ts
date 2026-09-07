/**
 * src/lib/fallback-pricing.ts
 *
 * Operator-curated bootstrap pricing for the curated picker. Used
 * by:
 *
 *   1. scripts/sync-pricing.ts when OpenRouter is unreachable —
 *      seeds model_pricing rows so the live path keeps working
 *      against a fresh-VPS-during-an-OR-outage scenario.
 *   2. src/lib/provider-display.ts to compute approximate per-query
 *      cost for the picker's "~N questions per day" labels.
 *
 * Lives separately from sync-pricing.ts so client-side code (the
 * picker, the chat-view) can import it without pulling in `pg` (the
 * Postgres driver) that sync-pricing's syncOne uses.
 *
 * Bump alongside CURATED_MODELS. Drop entries one release after a
 * model id rolls off the active picker. The CI guard
 * (src/__tests__/curated-models-coverage.test.ts) catches missing
 * entries at PR time.
 */

export interface ModelPrice {
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok: number | null; // null = model doesn't cache
}

export const FALLBACK_PRICING: Record<string, ModelPrice> = {
  // Picker defaults — every CURATED_MODELS entry in
  // src/lib/curated-models.ts gets a row here so a fresh-VPS sync
  // during an OpenRouter outage still seeds rows for everything the
  // live path can pick. BRD-model-selection §6.4.
  // Approximate bootstrap values; `npm run sync-pricing` overwrites
  // these with live OpenRouter rates on its next run.
  'deepseek/deepseek-v4-pro-0813': {
    input_per_mtok: 1.1154,
    output_per_mtok: 3.3462,
    cached_input_per_mtok: 0.0372,
  },
  'x-ai/grok-4.6': {
    input_per_mtok: 2.0,
    output_per_mtok: 6.0,
    cached_input_per_mtok: 0.50,
  },
  // NB: Gemini Flash is priced well below the other curated models
  // right now, but it's an agentic-coding-tuned model on introductory
  // pricing — treat its low per-query cost as promotional, not a
  // reason to make it the default. sync-pricing tracks the live rate.
  'google/gemini-3.8-flash': {
    input_per_mtok: 0.75,
    output_per_mtok: 3.75,
    cached_input_per_mtok: 0.075,
  },
  'anthropic/claude-sonnet-5': {
    input_per_mtok: 2.0,
    output_per_mtok: 10.0,
    cached_input_per_mtok: 0.20,
  },
  'openai/gpt-5.6-terra': {
    input_per_mtok: 2.50,
    output_per_mtok: 15.00,
    cached_input_per_mtok: 0.25,
  },

  // One-release safety net: the ids just rolled off the picker stay so
  // any queries still in flight against the previous defaults cost-out
  // correctly before the network sync runs. Drop on the next bump.
  'deepseek/deepseek-v4-pro': {
    input_per_mtok: 0.435,
    output_per_mtok: 0.870,
    cached_input_per_mtok: 0.0036,
  },
  'x-ai/grok-4.3': {
    input_per_mtok: 1.25,
    output_per_mtok: 2.50,
    cached_input_per_mtok: 0.20,
  },
  'google/gemini-3.6-flash': {
    input_per_mtok: 1.50,
    output_per_mtok: 7.50,
    cached_input_per_mtok: 0.15,
  },
};
