/**
 * src/__tests__/cost.test.ts
 *
 * Tests for src/lib/cost.ts (todo:92ebb9fd).
 * DB is mocked — no live Postgres needed.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  one:   vi.fn(),
  query: vi.fn(),
  exec:  vi.fn(),
}));

import * as db from '@/lib/db';
const mockOne = db.one as MockedFunction<typeof db.one>;

import { computeCost, getPricing } from '@/lib/cost';

const DEEPSEEK = {
  model_id: 'deepseek/deepseek-chat',
  input_price_per_mtok:        '0.14',
  output_price_per_mtok:       '0.28',
  cached_input_price_per_mtok: null,
  effective_from: new Date('2026-04-30T00:00:00Z'),
  effective_to:   null,
};

const SONNET = {
  model_id: 'anthropic/claude-sonnet-4.5',
  input_price_per_mtok:        '3.0',
  output_price_per_mtok:       '15.0',
  cached_input_price_per_mtok: '0.30',
  effective_from: new Date('2026-04-30T00:00:00Z'),
  effective_to:   null,
};

describe('getPricing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries model_pricing with the correct WHERE clause', async () => {
    mockOne.mockResolvedValueOnce(DEEPSEEK);
    const at = new Date('2026-05-01T12:00:00Z');
    await getPricing('deepseek/deepseek-chat', at);
    const [sql, params] = mockOne.mock.calls[0]!;
    expect(sql).toContain('FROM model_pricing');
    expect(sql).toContain('effective_from <= $2');
    expect(sql).toContain('effective_to IS NULL OR effective_to > $2');
    expect(params).toEqual(['deepseek/deepseek-chat', at]);
  });

  it('returns null when no row covers the timestamp', async () => {
    mockOne.mockResolvedValueOnce(null);
    const result = await getPricing('unknown-model');
    expect(result).toBeNull();
  });

  it('coerces string price columns to numbers', async () => {
    mockOne.mockResolvedValueOnce(SONNET);
    const result = await getPricing('anthropic/claude-sonnet-4.5');
    expect(result).toMatchObject({
      input_price_per_mtok: 3.0,
      output_price_per_mtok: 15.0,
      cached_input_price_per_mtok: 0.30,
    });
    expect(typeof result!.input_price_per_mtok).toBe('number');
  });

  it('preserves null cached_input_price (model does not cache)', async () => {
    mockOne.mockResolvedValueOnce(DEEPSEEK);
    const result = await getPricing('deepseek/deepseek-chat');
    expect(result!.cached_input_price_per_mtok).toBeNull();
  });
});

describe('computeCost', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DeepSeek query, no caching', async () => {
    mockOne.mockResolvedValueOnce(DEEPSEEK);
    const { cost_usd } = await computeCost({
      modelId: 'deepseek/deepseek-chat',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });
    // 1M input × $0.14 + 0.5M output × $0.28 = 0.14 + 0.14 = 0.28
    expect(cost_usd).toBeCloseTo(0.28, 6);
  });

  it('Sonnet query, no cache hits', async () => {
    mockOne.mockResolvedValueOnce(SONNET);
    const { cost_usd } = await computeCost({
      modelId: 'anthropic/claude-sonnet-4.5',
      inputTokens: 10_000,
      outputTokens: 1_000,
    });
    // 10K × $3/M + 1K × $15/M = 0.03 + 0.015 = 0.045
    expect(cost_usd).toBeCloseTo(0.045, 6);
  });

  it('Sonnet query with cache hit applies cached rate to cached portion', async () => {
    mockOne.mockResolvedValueOnce(SONNET);
    const { cost_usd } = await computeCost({
      modelId: 'anthropic/claude-sonnet-4.5',
      inputTokens: 10_000,
      outputTokens: 1_000,
      cachedInputTokens: 8_000,
    });
    // fresh: 2K × $3/M = 0.006
    // cached: 8K × $0.30/M = 0.0024
    // output: 1K × $15/M = 0.015
    // total: 0.0234
    expect(cost_usd).toBeCloseTo(0.0234, 6);
  });

  it('falls back to input rate when cached_input_price is null but cachedInputTokens > 0', async () => {
    // DeepSeek doesn't cache, but if a provider response somehow reports
    // cached tokens we shouldn't crash — bill them at input rate.
    mockOne.mockResolvedValueOnce(DEEPSEEK);
    const { cost_usd } = await computeCost({
      modelId: 'deepseek/deepseek-chat',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 500_000,
    });
    // All input billed at $0.14/M regardless of cache flag: 1M × $0.14 = 0.14
    expect(cost_usd).toBeCloseTo(0.14, 6);
  });

  it('throws when no pricing row exists for the model', async () => {
    mockOne.mockResolvedValueOnce(null);
    await expect(computeCost({
      modelId: 'unknown/model',
      inputTokens: 100,
      outputTokens: 100,
    })).rejects.toThrow(/No model_pricing row for unknown\/model/);
  });

  it('throws when cachedInputTokens exceeds inputTokens (malformed provider response)', async () => {
    mockOne.mockResolvedValueOnce(SONNET);
    await expect(computeCost({
      modelId: 'anthropic/claude-sonnet-4.5',
      inputTokens: 100,
      outputTokens: 0,
      cachedInputTokens: 200,
    })).rejects.toThrow(/cachedInputTokens \(200\) exceeds inputTokens \(100\)/);
  });

  it('passes `at` through to getPricing for historical lookups', async () => {
    mockOne.mockResolvedValueOnce(DEEPSEEK);
    const at = new Date('2026-04-15T00:00:00Z');
    await computeCost({
      modelId: 'deepseek/deepseek-chat',
      inputTokens: 100,
      outputTokens: 100,
      at,
    });
    const [, params] = mockOne.mock.calls[0]!;
    expect(params).toEqual(['deepseek/deepseek-chat', at]);
  });
});
