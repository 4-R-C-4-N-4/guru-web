/**
 * src/lib/model.ts
 *
 * OpenRouter completion client — non-streaming and streaming variants.
 * Uses the OpenAI SDK with OpenRouter's base URL.
 *
 * Model routing by tier:
 *   free → deepseek/deepseek-chat       (fast, cost-efficient)
 *   pro  → anthropic/claude-sonnet-4-5  (highest quality)
 */

import OpenAI from 'openai';
import { SYSTEM_PROMPT } from './prompt';

// Lazy-init: module-level `new OpenAI(...)` runs during Next.js build's
// page-data collection phase, where env vars may not be injected yet — the
// SDK constructor throws if OPENROUTER_API_KEY is missing. Constructing on
// first call keeps build-time safe while keeping runtime behavior identical
// (one client instance per process).
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'Guru',
      },
    });
  }
  return _client;
}

// Canonical OpenRouter model ids (matches what /api/v1/models advertises).
// queries.model_used + model_pricing.model_id agree on this form.
//
// MODELS retained for backwards compatibility during phase 1 of the
// model-selection rollout. New code paths read from CURATED_MODELS
// below via resolveCuratedModel(); /api/query will switch in C3.
export const MODELS = {
  free: 'deepseek/deepseek-chat',
  pro:  'anthropic/claude-sonnet-4.5',
} as const;

export type Tier = keyof typeof MODELS;

// ── Curated model picker ─────────────────────────────────────────────
//
// CURATED_MODELS, CuratedSlug, DEFAULT_CURATED_SLUG, resolveCuratedModel,
// isCuratedSlug — moved to src/lib/curated-models.ts so client-side code
// (e.g. /settings) can import them without pulling in the OpenAI SDK
// initialised at the top of this file. Re-exported here for back-compat
// with server-side consumers.
export {
  CURATED_MODELS,
  DEFAULT_CURATED_SLUG,
  resolveCuratedModel,
  isCuratedSlug,
} from './curated-models';
export type { CuratedSlug } from './curated-models';

// Headroom for the structured response format (analysis + MANDATORY
// citations block).  Previous 2048 cap was eating the citations section
// mid-token on long responses (todo:fac34c35).  Output tokens are billed
// only when actually used, so this is purely a "don't truncate" guard,
// not a typical-cost increase.  Both deepseek-chat and Claude Sonnet 4.5
// support at least 8192 output tokens.
export const MAX_OUTPUT_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Non-streaming completion (for internal/testing use)
// ---------------------------------------------------------------------------

/**
 * Non-streaming completion. Takes a resolved OpenRouter id directly
 * (post-model-selection BRD §7.2 — caller resolves slug → id, then
 * calls this). Pass MODELS[tier] for legacy tier-pinned callers, or
 * resolveCuratedModel(slug) for the picker path.
 */
export async function complete(prompt: string, modelId: string): Promise<string> {
  const response = await client().chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ],
    temperature: 0.3,
    max_tokens: MAX_OUTPUT_TOKENS,
  });
  return response.choices[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Streaming completion (used by POST /api/query)
// ---------------------------------------------------------------------------

export async function completeStream(prompt: string, modelId: string) {
  return client().chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ],
    temperature: 0.3,
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    // OpenAI-compatible streams omit usage by default; opt in so the API emits
    // a final chunk with prompt_tokens/completion_tokens (empty choices[]).
    stream_options: { include_usage: true },
  });
}
