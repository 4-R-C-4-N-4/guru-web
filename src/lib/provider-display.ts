/**
 * src/lib/provider-display.ts
 *
 * Display-side metadata for the curated picker — names users see,
 * colors used in the picker selected-state and the chat attribution
 * badge, and the reverse-mapping from a resolved OpenRouter model id
 * back to a CuratedSlug.
 *
 * Lives separately from curated-models.ts so the data layer stays
 * styling-free; curated-models.ts can be imported by anything,
 * including non-UI scripts. This module imports tokens.ts.
 *
 * questionsPerDay is *derived* from the pricing-config primitives —
 * the cap (PRO_DAILY_USD_CAP) and the typical-workload assumption
 * (TYPICAL_INPUT_TOKENS / TYPICAL_OUTPUT_TOKENS) — divided by per-
 * query cost looked up in FALLBACK_PRICING. Bumping the cap or a
 * provider rate updates the picker labels automatically; no
 * hand-edit of separate hardcoded numbers per slug.
 *
 * Spec: see todo:e8105324 — model-picker UX simplification.
 */

import { tokens } from '@/styles/tokens';
import { CURATED_MODELS, type CuratedSlug } from './curated-models';
import { FALLBACK_PRICING } from './fallback-pricing';
import {
  PRO_DAILY_USD_CAP,
  TYPICAL_INPUT_TOKENS,
  TYPICAL_OUTPUT_TOKENS,
} from './pricing-config';

export interface ProviderDisplay {
  /** Capitalised name shown to users — never includes the model version. */
  name: string;
  /** Token-derived color used for the picker selected-state ring and
   *  the chat-view per-response attribution badge. */
  color: string;
  /** Approximate questions-per-day at PRO_DAILY_USD_CAP and the
   *  typical-workload assumption. Computed at module load from
   *  pricing-config + FALLBACK_PRICING; never hardcoded.
   *
   *  Math: floor(PRO_DAILY_USD_CAP / per-query cost), where
   *  per-query cost = (input_tokens × input_per_mtok + output_tokens
   *  × output_per_mtok) / 1e6. */
  questionsPerDay: number;
}

/** Per-slug name + color. Bumping a CURATED_MODELS entry usually
 *  doesn't require touching this — colors and names belong to the
 *  provider, not the specific model version. */
const PROVIDER_META: Record<CuratedSlug, { name: string; color: string }> = {
  deepseek:  { name: 'DeepSeek',  color: tokens.tradition.neoplatonism }, // muted blue
  xai:       { name: 'X.AI',      color: tokens.tradition.gnosticism },   // rust
  anthropic: { name: 'Anthropic', color: tokens.tier.verified },          // amber
  openai:    { name: 'OpenAI',    color: tokens.tradition.buddhism },     // muted green
};

/**
 * Estimate per-query USD cost for a slug at the typical-workload
 * assumption. Sources rates from FALLBACK_PRICING (operator-curated
 * bootstrap). Returns Infinity for missing fallback so questionsPerDay
 * collapses to 0 — surfaces the "I forgot to add a fallback" mistake
 * loudly.
 */
function estimateQueryCostUsd(slug: CuratedSlug): number {
  const modelId = CURATED_MODELS[slug];
  const fallback = FALLBACK_PRICING[modelId];
  if (!fallback) return Infinity;
  return (
    (TYPICAL_INPUT_TOKENS  / 1e6) * fallback.input_per_mtok +
    (TYPICAL_OUTPUT_TOKENS / 1e6) * fallback.output_per_mtok
  );
}

function computeQuestionsPerDay(slug: CuratedSlug): number {
  const cost = estimateQueryCostUsd(slug);
  if (cost <= 0 || !Number.isFinite(cost)) return 0;
  // Floor (not round) so the displayed "~N" matches what the user
  // can actually do before the cap binds. Math.round overpromises:
  // at $0.045/query Anthropic gives 0.1667/0.045 = 3.7 queries
  // before cap, which round → 4 but the 4th query is rejected. The
  // user counting to 3 then seeing 429 with "~4 per day" displayed
  // is the wrong first impression. todo:068a8039 review.
  return Math.floor(PRO_DAILY_USD_CAP / cost);
}

/**
 * Per-slug display metadata — name + color from PROVIDER_META,
 * questionsPerDay computed at module load. Picker rows and the chat
 * attribution badge read from this; both stay accurate when pricing
 * config or fallback rates move.
 */
export const PROVIDER_DISPLAY: Record<CuratedSlug, ProviderDisplay> = {
  deepseek:  { ...PROVIDER_META.deepseek,  questionsPerDay: computeQuestionsPerDay('deepseek')  },
  xai:       { ...PROVIDER_META.xai,       questionsPerDay: computeQuestionsPerDay('xai')       },
  anthropic: { ...PROVIDER_META.anthropic, questionsPerDay: computeQuestionsPerDay('anthropic') },
  openai:    { ...PROVIDER_META.openai,    questionsPerDay: computeQuestionsPerDay('openai')    },
};

/**
 * Reverse-map an OpenRouter model id to its CuratedSlug. Robust to
 * version bumps — `anthropic/claude-sonnet-4.6` and a future
 * `anthropic/claude-sonnet-5` both map to 'anthropic'. Returns null
 * for ids outside the curated providers (legacy rows, dev pokes,
 * etc.) so the caller can choose to render or skip the badge.
 */
export function providerSlugFromModelId(modelId: string): CuratedSlug | null {
  // OpenRouter uses 'x-ai/...' but our slug is 'xai' — translate.
  const prefix = modelId.split('/', 1)[0];
  switch (prefix) {
    case 'deepseek':  return 'deepseek';
    case 'x-ai':      return 'xai';
    case 'anthropic': return 'anthropic';
    case 'openai':    return 'openai';
    default:          return null;
  }
}

/**
 * Convenience: id → display metadata, or null if the id isn't from
 * a curated provider. Used by the chat-view per-response badge.
 */
export function displayForModelId(modelId: string | null | undefined): ProviderDisplay | null {
  if (!modelId) return null;
  const slug = providerSlugFromModelId(modelId);
  return slug ? PROVIDER_DISPLAY[slug] : null;
}
