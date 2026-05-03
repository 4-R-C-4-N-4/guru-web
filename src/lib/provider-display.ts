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
 * Spec: see todo:e8105324 — model-picker UX simplification.
 */

import { tokens } from '@/styles/tokens';
import type { CuratedSlug } from './curated-models';

export interface ProviderDisplay {
  /** Capitalised name shown to users — never includes the model version. */
  name: string;
  /** Token-derived color used for the picker selected-state ring and
   *  the chat-view per-response attribution badge. */
  color: string;
  /** Approximate questions-per-day at the $0.17 USD cap and our
   *  typical-case workload (10k input + 1k output). Static; bit-rot
   *  accepted — the daily sync-pricing timer + admin telemetry
   *  catches real drift. Recompute on a CURATED_MODELS bump.
   *  todo:e8105324. */
  questionsPerDay: number;
}

/**
 * Per-slug display metadata. Bumping a CURATED_MODELS entry usually
 * doesn't require touching this — the colors and names belong to the
 * provider, not the specific model version. Refresh
 * questionsPerDay when a bump materially changes per-query cost.
 */
export const PROVIDER_DISPLAY: Record<CuratedSlug, ProviderDisplay> = {
  deepseek: {
    name: 'DeepSeek',
    color: tokens.tradition.neoplatonism,  // muted blue
    questionsPerDay: 30,
  },
  xai: {
    name: 'X.AI',
    color: tokens.tradition.gnosticism,    // rust
    questionsPerDay: 10,
  },
  anthropic: {
    name: 'Anthropic',
    color: tokens.tier.verified,           // amber
    questionsPerDay: 4,
  },
  openai: {
    name: 'OpenAI',
    color: tokens.tradition.buddhism,      // muted green
    questionsPerDay: 4,
  },
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
