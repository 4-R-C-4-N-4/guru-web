/**
 * src/__tests__/compress.test.ts
 * Unit tests for extractive compression.
 */

import { describe, it, expect } from 'vitest';
import { compressBody, compressChunks } from '@/lib/compress';
import { estimateTokens } from '@/lib/budget';
import type { RetrievedChunk } from '@/lib/types';

const makeChunk = (body: string): RetrievedChunk => ({
  id: 'c1',
  text_id: 'text-1',
  tradition: 'hermeticism',
  text_name: 'Corpus Hermeticum',
  section: 'I.6',
  translator: null,
  body,
  token_count: estimateTokens(body),
  source: 'vector',
  tier: 'proposed',
});

describe('compressBody', () => {
  it('returns body unchanged when it already fits', () => {
    const body = 'Short text.';
    expect(compressBody(body, 'divine light', 100)).toBe(body);
  });

  it('returns a shorter result when body exceeds targetTokens', () => {
    const body = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} about divine spark light.`).join(' ');
    const target = 20;
    const result = compressBody(body, 'divine spark', target);
    expect(estimateTokens(result)).toBeLessThanOrEqual(target + 5); // small fuzz for sentence boundaries
    expect(result.length).toBeLessThan(body.length);
  });

  it('returns at least one sentence even if it slightly exceeds target', () => {
    const body = 'The divine spark is within you. Ego death is the gateway.';
    const result = compressBody(body, 'divine spark', 1); // impossibly small target
    expect(result.length).toBeGreaterThan(0);
  });

  it('prefers sentences that match query terms', () => {
    const body = 'The sky is blue. The divine spark is the light within. Rocks are hard.';
    const result = compressBody(body, 'divine spark light', 15);
    expect(result).toContain('divine spark');
  });
});

describe('compressChunks', () => {
  it('does not modify chunks that already fit', () => {
    const chunk = makeChunk('Short body.');
    const result = compressChunks([chunk], 'query', 100);
    expect(result[0]).toBe(chunk); // same reference — not mutated
  });

  it('returns new objects for chunks that were compressed', () => {
    const longBody = Array.from({ length: 40 }, (_, i) => `The concept of gnosis in tradition ${i} is profound.`).join(' ');
    const chunk = makeChunk(longBody);
    const result = compressChunks([chunk], 'gnosis', 20);
    expect(result[0]).not.toBe(chunk);
    expect(result[0].token_count).toBeLessThanOrEqual(chunk.token_count);
  });
});
