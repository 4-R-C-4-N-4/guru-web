/**
 * src/lib/curated-models.ts
 *
 * Slug → OpenRouter id map for the curated model picker, plus the
 * resolver and type guard. Lives in its own file (separate from
 * model.ts) so client-side code can import these without pulling in
 * the OpenAI SDK that model.ts initialises.
 *
 * Spec: BRD-model-selection.md §5.1.
 *
 * Bumping an entry IS the version-rollover mechanism. After editing,
 * run `npm run sync-pricing` so model_pricing has a row for the new
 * id (`computeCost` throws if missing — see BRD §5.4). The CI guard
 * (src/__tests__/curated-models-coverage.test.ts) catches "I forgot
 * to add a fallback row" as a red CI run.
 *
 * FALLBACK_PRICING in scripts/sync-pricing.ts mirrors this map so a
 * fresh-VPS sync during an OpenRouter outage still seeds rows.
 */

export const CURATED_MODELS = {
  deepseek:  'deepseek/deepseek-v4-pro',
  xai:       'x-ai/grok-4.3',
  google:    'google/gemini-3.6-flash',
  anthropic: 'anthropic/claude-sonnet-5',
  openai:    'openai/gpt-5.6-terra',
} as const;

export type CuratedSlug = keyof typeof CURATED_MODELS;

/**
 * The default slug picked when a free user queries, or when a pro
 * user has no preferred_model saved. Spec: BRD-model-selection.md
 * §1, §4.1.
 */
export const DEFAULT_CURATED_SLUG: CuratedSlug = 'deepseek';

/**
 * Resolve a slug to its current OpenRouter model id. Throws on
 * unknown slug — TypeScript should catch this at compile time, but
 * the runtime check guards against stale preference rows that
 * predate a slug rename.
 */
export function resolveCuratedModel(slug: CuratedSlug): string {
  const id = CURATED_MODELS[slug];
  if (!id) {
    throw new Error(`Unknown CURATED_MODELS slug: ${slug as string}`);
  }
  return id;
}

/**
 * Type guard for arbitrary string input (e.g. user_preferences row
 * read from DB, request body field). Rejects values that don't match
 * a current slug. Used by /api/preferences validation and by
 * /api/query when reading saved preferences.
 */
export function isCuratedSlug(value: unknown): value is CuratedSlug {
  return typeof value === 'string' && value in CURATED_MODELS;
}

/**
 * Per-slug preferred upstream provider name for the OpenRouter
 * `provider.order` extension. Without this, OpenRouter may route to
 * third-party hosters (e.g. AtlasCloud for deepseek) that don't expose
 * the upstream's prompt-caching tier — silently turning off cache hits
 * and burning the cost discount.
 *
 * Names must match OpenRouter's canonical provider strings exactly;
 * typos silently fall back to default routing because the chat-
 * completions request uses `allow_fallbacks: true`. Verify against
 * `https://openrouter.ai/api/v1/models/{model}/endpoints` when adding
 * or renaming an entry.
 *
 * Spec: BUGFIX-openrouter-provider-routing.md.
 */
export const PREFERRED_PROVIDER: Record<CuratedSlug, string> = {
  deepseek:  'DeepSeek',
  xai:       'xAI',
  // Gemini's first-party endpoints are 'Google AI Studio' (developer
  // API) and 'Google' (Vertex); pin AI Studio, Vertex stays reachable
  // via allow_fallbacks.
  google:    'Google AI Studio',
  anthropic: 'Anthropic',
  openai:    'OpenAI',
};

export function preferredProviderFor(slug: CuratedSlug): string {
  return PREFERRED_PROVIDER[slug];
}
