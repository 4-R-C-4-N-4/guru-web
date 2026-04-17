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

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    'X-Title': 'Guru',
  },
});

export const MODELS = {
  free: 'deepseek/deepseek-chat',
  pro:  'anthropic/claude-sonnet-4-5',
} as const;

export type Tier = keyof typeof MODELS;

// ---------------------------------------------------------------------------
// Non-streaming completion (for internal/testing use)
// ---------------------------------------------------------------------------

export async function complete(prompt: string, tier: Tier): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODELS[tier],
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  });
  return response.choices[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Streaming completion (used by POST /api/query)
// ---------------------------------------------------------------------------

export async function completeStream(prompt: string, tier: Tier) {
  return client.chat.completions.create({
    model: MODELS[tier],
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 2048,
    stream: true,
  });
}
