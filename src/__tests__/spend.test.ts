/**
 * src/__tests__/spend.test.ts
 *
 * Tests for src/lib/spend.ts (todo:e8e441a8).
 * DB is mocked — no live Postgres needed.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  one:   vi.fn(),
  exec:  vi.fn(),
  query: vi.fn(),
}));

import * as db from '@/lib/db';
const mockOne  = db.one  as MockedFunction<typeof db.one>;
const mockExec = db.exec as MockedFunction<typeof db.exec>;

import { reserveBudget, finalizeBudget, getBudget, TIER_LIMITS } from '@/lib/spend';

describe('reserveBudget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts the row, then atomically check-increments under the limit', async () => {
    mockExec.mockResolvedValueOnce(undefined);                                // upsert
    mockOne.mockResolvedValueOnce({ queries_used: 1, usd_used: 0, query_limit: 10, usd_limit: null }); // increment

    const result = await reserveBudget({ userId: 'u1', tier: 'free', estimatedCostUsd: 0.001 });
    expect(result).toEqual({
      allowed: true,
      queries_used: 1, usd_used: 0,
      query_limit: 10, usd_limit: null,
    });
    expect(mockExec).toHaveBeenCalledOnce();
    const [upsertSql, upsertParams] = mockExec.mock.calls[0]!;
    expect(upsertSql).toContain('INSERT INTO user_budgets');
    expect(upsertSql).toContain('ON CONFLICT (user_id, period) DO UPDATE');
    expect(upsertParams).toEqual(['u1', 'daily', 10, null]);

    const [updateSql, updateParams] = mockOne.mock.calls[0]!;
    expect(updateSql).toContain('queries_used + 1 <= query_limit');
    expect(updateSql).toContain('usd_used + $3 <= usd_limit');
    expect(updateParams).toEqual(['u1', 'daily', 0.001]);
  });

  it('rejected with reason=queries when at the query limit', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    // increment UPDATE returns no row (excluded by WHERE)
    mockOne.mockResolvedValueOnce(null);
    // status SELECT shows already at limit
    mockOne.mockResolvedValueOnce({ queries_used: 10, usd_used: 0, query_limit: 10, usd_limit: null });

    const result = await reserveBudget({ userId: 'u1', tier: 'free', estimatedCostUsd: 0.001 });
    expect(result).toMatchObject({ allowed: false, reason: 'queries', queries_used: 10, query_limit: 10 });
  });

  it('rejected with reason=usd when usd_limit would overrun', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    mockOne.mockResolvedValueOnce(null);
    mockOne.mockResolvedValueOnce({ queries_used: 5, usd_used: '0.49', query_limit: 30, usd_limit: '0.50' });

    const result = await reserveBudget({ userId: 'u1', tier: 'pro', estimatedCostUsd: 0.05 });
    expect(result).toMatchObject({ allowed: false, reason: 'usd', usd_used: 0.49, usd_limit: 0.50 });
  });

  it('writes the tier limits on every call (so tier upgrade takes effect)', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    mockOne.mockResolvedValueOnce({ queries_used: 1, usd_used: 0, query_limit: 30, usd_limit: null });

    await reserveBudget({ userId: 'u1', tier: 'pro', estimatedCostUsd: 0.001 });
    const [, params] = mockExec.mock.calls[0]!;
    expect(params).toEqual(['u1', 'daily', TIER_LIMITS.pro.query_limit, TIER_LIMITS.pro.usd_limit]);
  });

  it('passes the limits through unchanged when both axes are unenforced (null)', async () => {
    // Hypothetical future tier with null/null — never rejects on either axis.
    mockExec.mockResolvedValueOnce(undefined);
    mockOne.mockResolvedValueOnce({ queries_used: 9999, usd_used: 9999, query_limit: null, usd_limit: null });

    const result = await reserveBudget({ userId: 'u1', tier: 'pro', estimatedCostUsd: 100 });
    expect(result).toMatchObject({ allowed: true, query_limit: null, usd_limit: null });
  });

  it('upsert SQL bumps reset_at when stale (lazy period reset)', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    mockOne.mockResolvedValueOnce({ queries_used: 1, usd_used: 0, query_limit: 10, usd_limit: null });

    await reserveBudget({ userId: 'u1', tier: 'free', estimatedCostUsd: 0 });
    const [sql] = mockExec.mock.calls[0]!;
    // Lazy-reset clause: counters zero, reset_at bumped, only when reset_at <= now()
    expect(sql).toMatch(/queries_used\s*=\s*CASE WHEN user_budgets\.reset_at <= now\(\)\s+THEN 0 ELSE user_budgets\.queries_used END/);
    expect(sql).toMatch(/reset_at\s*=\s*CASE WHEN user_budgets\.reset_at <= now\(\)/);
  });
});

describe('finalizeBudget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('decreases usd_used when actual is below estimated (typical case)', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    await finalizeBudget({ userId: 'u1', estimatedCostUsd: 0.10, actualCostUsd: 0.04 });
    expect(mockExec).toHaveBeenCalledOnce();
    const [sql, params] = mockExec.mock.calls[0]!;
    expect(sql).toContain('GREATEST(0, usd_used + $3)');
    expect(params![0]).toBe('u1');
    expect(params![1]).toBe('daily');
    expect(params![2] as number).toBeCloseTo(-0.06, 6);
  });

  it('increases usd_used when actual exceeds estimated (provider overrun)', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    await finalizeBudget({ userId: 'u1', estimatedCostUsd: 0.10, actualCostUsd: 0.12 });
    const [, params] = mockExec.mock.calls[0]!;
    expect(params![2]).toBeCloseTo(0.02, 6);
  });

  it('skips the UPDATE when delta is zero', async () => {
    await finalizeBudget({ userId: 'u1', estimatedCostUsd: 0.10, actualCostUsd: 0.10 });
    expect(mockExec).not.toHaveBeenCalled();
  });
});

describe('getBudget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the row when it exists, coerced to numbers', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: 5, usd_used: '0.025', query_limit: 30, usd_limit: '0.50' });
    const result = await getBudget('u1', 'pro');
    expect(result).toEqual({ queries_used: 5, usd_used: 0.025, query_limit: 30, usd_limit: 0.50 });
  });

  it('returns tier defaults with zero usage when no row exists yet', async () => {
    mockOne.mockResolvedValueOnce(null);
    const result = await getBudget('u1', 'free');
    expect(result).toEqual({
      queries_used: 0, usd_used: 0,
      query_limit: TIER_LIMITS.free.query_limit,
      usd_limit:   TIER_LIMITS.free.usd_limit,
    });
  });
});

describe('TIER_LIMITS', () => {
  // Lock the live values — accidental drift fails CI loudly. See
  // BRD-model-selection.md §6.2 for the $0.17/day rationale.
  it('free tier: 10 queries, no USD cap', () => {
    expect(TIER_LIMITS.free).toEqual({ query_limit: 10, usd_limit: null });
  });

  it('pro tier: 100 queries (soft) + $0.17/day USD cap (primary)', () => {
    expect(TIER_LIMITS.pro).toEqual({ query_limit: 100, usd_limit: 0.17 });
  });
});

describe('reserveBudget — pro dual-axis (model-selection BRD §3.2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects pro for usd reason at $0.17 cap even when queries_used is well below 100', async () => {
    // Sonnet costs ~$0.045/query, so day 4 takes a pro user from
    // ~$0.135 used to ~$0.18 — over the $0.17/day cap with only
    // 4 queries against a 100/day soft limit.
    mockExec.mockResolvedValueOnce(undefined);
    mockOne.mockResolvedValueOnce(null); // increment WHERE excluded → null
    mockOne.mockResolvedValueOnce({
      queries_used: 3, usd_used: '0.135',
      query_limit: 100, usd_limit: '0.17',
    });

    const result = await reserveBudget({ userId: 'u1', tier: 'pro', estimatedCostUsd: 0.045 });
    expect(result).toMatchObject({
      allowed: false,
      reason: 'usd',
      queries_used: 3,
      usd_used: 0.135,
      usd_limit: 0.17,
    });
  });

  it('allows pro under both axes (DeepSeek at $0.005/query, day 1)', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    mockOne.mockResolvedValueOnce({
      queries_used: 1, usd_used: '0.005',
      query_limit: 100, usd_limit: '0.17',
    });

    const result = await reserveBudget({ userId: 'u1', tier: 'pro', estimatedCostUsd: 0.005 });
    expect(result).toMatchObject({ allowed: true, query_limit: 100, usd_limit: 0.17 });
  });
});
