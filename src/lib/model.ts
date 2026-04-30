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

export const MODELS = {
  free: 'deepseek/deepseek-chat',
  pro:  'anthropic/claude-sonnet-4-5',
} as const;

export type Tier = keyof typeof MODELS;

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

export async function complete(prompt: string, tier: Tier): Promise<string> {
  const response = await client().chat.completions.create({
    model: MODELS[tier],
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

export async function completeStream(prompt: string, tier: Tier) {
  return client().chat.completions.create({
    model: MODELS[tier],
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
