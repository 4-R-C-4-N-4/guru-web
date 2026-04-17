/**
 * src/__tests__/budget.test.ts
 * Unit tests for TokenBudget and estimateTokens.
 */

import { describe, it, expect } from 'vitest';
import { TokenBudget, estimateTokens, makeBudget } from '@/lib/budget';
import type { RetrievedChunk } from '@/lib/types';

const makeChunk = (id: string, body: string, tier: RetrievedChunk['tier'] = 'verified'): RetrievedChunk => ({
  id,
  text_id: 'text-1',
  tradition: 'gnosticism',
  text_name: 'Gospel of Thomas',
  section: 'Logion 1',
  translator: null,
  body,
  token_count: estimateTokens(body),
  source: 'vector',
  tier,
});

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 -> ceil = 3
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('TokenBudget', () => {
  it('starts with correct available tokens', () => {
    const b = new TokenBudget(8192, 512, 2048);
    expect(b.available).toBe(8192 - 512 - 2048);
  });

  it('fits when tokens <= remaining', () => {
    const b = new TokenBudget(1000, 0, 0);
    expect(b.fits(1000)).toBe(true);
    expect(b.fits(1001)).toBe(false);
  });

  it('consume reduces available', () => {
    const b = new TokenBudget(1000, 0, 0);
    b.consume(200);
    expect(b.available).toBe(800);
  });

  it('consume throws when over budget', () => {
    const b = new TokenBudget(100, 0, 0);
    expect(() => b.consume(101)).toThrow(/TokenBudget exceeded/);
  });

  it('fitChunks accepts chunks that fit, skips those that do not', () => {
    const b = new TokenBudget(100, 0, 0); // 100 tokens available
    // Each chunk body: 'x'.repeat(n) -> estimateTokens = ceil(n/4)
    const bigChunk  = makeChunk('big',   'x'.repeat(400)); // 100 tokens
    const tinyChunk = makeChunk('tiny',  'x'.repeat(4));   // 1 token
    const bigChunk2 = makeChunk('big2',  'x'.repeat(400)); // 100 tokens (won't fit after big)

    const result = b.fitChunks([bigChunk, tinyChunk, bigChunk2]);
    expect(result.map(c => c.id)).toEqual(['big']); // big fits exactly, tiny would need 1 more but budget is 0
  });

  it('fitChunks accepts multiple small chunks', () => {
    const b = new TokenBudget(10, 0, 0);
    const chunks = [
      makeChunk('a', 'word'),      // ceil(4/4)=1 token
      makeChunk('b', 'word word'), // ceil(9/4)=3 tokens
      makeChunk('c', 'word word'), // 3 tokens
      makeChunk('d', 'word word'), // 3 tokens — total so far: 1+3+3+3=10 exactly
    ];
    const result = b.fitChunks(chunks);
    expect(result.length).toBe(4);
    expect(b.available).toBe(0);
  });
});

describe('makeBudget', () => {
  it('free tier has smaller window', () => {
    const free = makeBudget('free');
    const pro  = makeBudget('pro');
    expect(free.available).toBeLessThan(pro.available);
  });
});
