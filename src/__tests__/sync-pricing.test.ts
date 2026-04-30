/**
 * src/__tests__/sync-pricing.test.ts
 *
 * Unit tests for the pure helpers in scripts/sync-pricing.ts (todo:8832ce67).
 * DB and network are not exercised — those are tested manually against a
 * real OpenRouter response when the operator runs the script.
 */
import { describe, it, expect } from 'vitest';
import { extractPricing, pricingMatches } from '../../scripts/sync-pricing';

describe('extractPricing', () => {
  const ALLOWLIST = ['deepseek/deepseek-chat', 'anthropic/claude-sonnet-4-5'] as const;

  it('converts per-token prices to per-Mtok USD', () => {
    const out = extractPricing({
      data: [{
        id: 'deepseek/deepseek-chat',
        pricing: { prompt: '0.00000014', completion: '0.00000028' },
      }],
    }, ALLOWLIST);
    expect(out['deepseek/deepseek-chat']).toEqual({
      input_per_mtok: 0.14,
      output_per_mtok: 0.28,
      cached_input_per_mtok: null,
    });
  });

  it('reads input_cache_read when present (Anthropic)', () => {
    const out = extractPricing({
      data: [{
        id: 'anthropic/claude-sonnet-4-5',
        pricing: {
          prompt: '0.000003',
          completion: '0.000015',
          input_cache_read: '0.0000003',
        },
      }],
    }, ALLOWLIST);
    expect(out['anthropic/claude-sonnet-4-5']).toEqual({
      input_per_mtok: 3.0,
      output_per_mtok: 15.0,
      cached_input_per_mtok: 0.30,
    });
  });

  it('skips models not in the allowlist', () => {
    const out = extractPricing({
      data: [
        { id: 'openai/gpt-4', pricing: { prompt: '0.00003', completion: '0.00006' } },
        { id: 'deepseek/deepseek-chat', pricing: { prompt: '0.00000014', completion: '0.00000028' } },
      ],
    }, ALLOWLIST);
    expect(Object.keys(out)).toEqual(['deepseek/deepseek-chat']);
  });

  it('skips entries without prompt or completion fields', () => {
    const out = extractPricing({
      data: [
        { id: 'deepseek/deepseek-chat', pricing: {} },
      ],
    }, ALLOWLIST);
    expect(out).toEqual({});
  });
});

describe('pricingMatches', () => {
  const A = { input_per_mtok: 0.14, output_per_mtok: 0.28, cached_input_per_mtok: null };

  it('returns true for identical prices (no caching)', () => {
    expect(pricingMatches(A, { ...A })).toBe(true);
  });

  it('returns false on differing input price', () => {
    expect(pricingMatches(A, { ...A, input_per_mtok: 0.15 })).toBe(false);
  });

  it('returns false on differing output price', () => {
    expect(pricingMatches(A, { ...A, output_per_mtok: 0.30 })).toBe(false);
  });

  it('returns true when both cached prices are null', () => {
    expect(pricingMatches(
      { input_per_mtok: 1, output_per_mtok: 2, cached_input_per_mtok: null },
      { input_per_mtok: 1, output_per_mtok: 2, cached_input_per_mtok: null },
    )).toBe(true);
  });

  it('returns false when cached drift between null and a number', () => {
    expect(pricingMatches(
      { input_per_mtok: 3, output_per_mtok: 15, cached_input_per_mtok: null },
      { input_per_mtok: 3, output_per_mtok: 15, cached_input_per_mtok: 0.30 },
    )).toBe(false);
  });

  it('returns true when both cached prices match', () => {
    expect(pricingMatches(
      { input_per_mtok: 3, output_per_mtok: 15, cached_input_per_mtok: 0.30 },
      { input_per_mtok: 3, output_per_mtok: 15, cached_input_per_mtok: 0.30 },
    )).toBe(true);
  });
});
