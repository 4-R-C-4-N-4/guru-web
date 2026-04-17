/**
 * src/lib/embed.ts
 *
 * Query embedding via OpenRouter using nomic-ai/nomic-embed-text-v1.5.
 * Dimension: 768. Must match whatever the Python pipeline used when
 * generating corpus embeddings — dimension mismatch breaks vector search.
 */

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

const EMBEDDING_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

export async function embed(text: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}
