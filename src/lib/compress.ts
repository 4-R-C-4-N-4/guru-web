/**
 * src/lib/compress.ts
 *
 * Extractive compression of retrieved chunks.
 * When the full chunk body would exceed budget, we extract the most
 * query-relevant sentences rather than dropping the chunk entirely.
 *
 * Strategy: score sentences by keyword overlap with the query, keep the
 * top N sentences that fit within the target token limit.
 */

import { estimateTokens } from './budget';
import type { RetrievedChunk } from './types';

const SENTENCE_RE = /[^.!?]+[.!?]+/g;

/**
 * Score a sentence against the query by normalised term overlap.
 */
function scoreSentence(sentence: string, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const words = sentence.toLowerCase().split(/\s+/);
  const matches = words.filter(w => queryTokens.has(w)).length;
  return matches / queryTokens.size;
}

/**
 * Compress a single chunk body to fit within `targetTokens`.
 * Returns the original body unchanged if it already fits.
 * If no sentences score > 0, returns the first sentence(s) that fit.
 */
export function compressBody(
  body: string,
  queryText: string,
  targetTokens: number
): string {
  if (estimateTokens(body) <= targetTokens) return body;

  const sentences = body.match(SENTENCE_RE) ?? [body];
  const queryTokens = new Set(
    queryText.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );

  const scored = sentences.map(s => ({
    text: s.trim(),
    score: scoreSentence(s, queryTokens),
  }));

  // Sort by relevance descending, then rebuild in original order
  const ranked = [...scored].sort((a, b) => b.score - a.score);

  const kept = new Set<string>();
  let tokenCount = 0;

  for (const { text } of ranked) {
    const t = estimateTokens(text);
    if (tokenCount + t <= targetTokens) {
      kept.add(text);
      tokenCount += t;
    }
    if (tokenCount >= targetTokens) break;
  }

  if (kept.size === 0 && sentences.length > 0) {
    // Fallback: first sentence only
    return sentences[0].trim();
  }

  // Reconstruct in original order
  return scored
    .filter(s => kept.has(s.text))
    .map(s => s.text)
    .join(' ');
}

/**
 * Apply extractive compression to all chunks that exceed `targetTokens`.
 * Mutates a shallow copy of each chunk — originals are not modified.
 */
export function compressChunks(
  chunks: RetrievedChunk[],
  queryText: string,
  targetTokensPerChunk: number
): RetrievedChunk[] {
  return chunks.map(chunk => {
    const compressed = compressBody(chunk.body, queryText, targetTokensPerChunk);
    if (compressed === chunk.body) return chunk;
    return {
      ...chunk,
      body: compressed,
      token_count: estimateTokens(compressed),
    };
  });
}
