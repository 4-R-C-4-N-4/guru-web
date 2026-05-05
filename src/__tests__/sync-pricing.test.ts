/**
 * src/__tests__/sync-pricing.test.ts
 *
 * Unit tests for the pure helpers in scripts/sync-pricing.ts.
 * DB and network are not exercised — those are tested manually against a
 * real OpenRouter response when the operator runs the script.
 */
import { describe, it, expect } from 'vitest';
import { extractPricing, findMissingCuratedIds, pricingMatches } from '../../scripts/sync-pricing';

describe('extractPricing', () => {
  // Provider-prefix allowlist (todo:fbd30eff). Models with ids
  // starting with one of these provider names get pricing extracted;
  // anything else is skipped.
  const PROVIDERS = ['anthropic', 'openai', 'deepseek'] as const;

  it('converts per-token prices to per-Mtok USD', () => {
    const out = extractPricing({
      data: [{
        id: 'deepseek/deepseek-chat',
        pricing: { prompt: '0.00000014', completion: '0.00000028' },
      }],
    }, PROVIDERS);
    expect(out['deepseek/deepseek-chat']).toEqual({
      input_per_mtok: 0.14,
      output_per_mtok: 0.28,
      cached_input_per_mtok: null,
    });
  });

  it('reads input_cache_read when present (Anthropic)', () => {
    const out = extractPricing({
      data: [{
        id: 'anthropic/claude-sonnet-4.5',
        pricing: {
          prompt: '0.000003',
          completion: '0.000015',
          input_cache_read: '0.0000003',
        },
      }],
    }, PROVIDERS);
    expect(out['anthropic/claude-sonnet-4.5']).toEqual({
      input_per_mtok: 3.0,
      output_per_mtok: 15.0,
      cached_input_per_mtok: 0.30,
    });
  });

  it('keeps OpenRouter ids verbatim — no aliasing (todo:fbd30eff)', () => {
    // The whole point of this PR: model_pricing.model_id must match
    // exactly what OpenRouter advertises and what queries.model_used
    // stores.  No hyphen↔dot mapping anywhere.
    const out = extractPricing({
      data: [{
        id: 'anthropic/claude-sonnet-4.5',
        pricing: { prompt: '0.000003', completion: '0.000015' },
      }],
    }, PROVIDERS);
    expect(Object.keys(out)).toEqual(['anthropic/claude-sonnet-4.5']);
    expect(out['anthropic/claude-sonnet-4-5']).toBeUndefined();
  });

  it('extracts every model from allowed providers (pre-load)', () => {
    const out = extractPricing({
      data: [
        { id: 'anthropic/claude-sonnet-4.5', pricing: { prompt: '0.000003',  completion: '0.000015'  } },
        { id: 'anthropic/claude-opus-4.5',   pricing: { prompt: '0.000015',  completion: '0.000075'  } },
        { id: 'openai/gpt-4o',               pricing: { prompt: '0.0000025', completion: '0.00001'   } },
        { id: 'deepseek/deepseek-chat',      pricing: { prompt: '0.00000014', completion: '0.00000028' } },
      ],
    }, PROVIDERS);
    expect(Object.keys(out).sort()).toEqual([
      'anthropic/claude-opus-4.5',
      'anthropic/claude-sonnet-4.5',
      'deepseek/deepseek-chat',
      'openai/gpt-4o',
    ]);
  });

  it('skips models from providers not in the allowlist', () => {
    const out = extractPricing({
      data: [
        { id: 'nvidia/nemotron-3', pricing: { prompt: '0.0000001', completion: '0.0000002' } },
        { id: 'qwen/qwen3-coder',  pricing: { prompt: '0.0000001', completion: '0.0000002' } },
      ],
    }, PROVIDERS);
    expect(out).toEqual({});
  });

  it('skips entries without prompt or completion fields', () => {
    const out = extractPricing({
      data: [
        { id: 'deepseek/deepseek-chat', pricing: {} },
      ],
    }, PROVIDERS);
    expect(out).toEqual({});
  });
});

describe('findMissingCuratedIds (todo:bcb7ea04)', () => {
  const CURATED = {
    deepseek:  'deepseek/deepseek-v4-pro',
    anthropic: 'anthropic/claude-sonnet-4.6',
  } as const;

  it('returns empty when every curated id is present', () => {
    const remote = {
      'deepseek/deepseek-v4-pro':     {},
      'anthropic/claude-sonnet-4.6':  {},
      'openai/gpt-4o':                {},
    };
    expect(findMissingCuratedIds(remote, CURATED)).toEqual([]);
  });

  it('returns the missing slug+id pairs when ids drift out of OpenRouter', () => {
    const remote = {
      'deepseek/deepseek-v4-pro': {},
      // anthropic/claude-sonnet-4.6 silently removed upstream
    };
    expect(findMissingCuratedIds(remote, CURATED)).toEqual([
      { slug: 'anthropic', id: 'anthropic/claude-sonnet-4.6' },
    ]);
  });

  it('returns all curated ids when remote is empty', () => {
    expect(findMissingCuratedIds({}, CURATED)).toHaveLength(2);
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
