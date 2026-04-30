/**
 * src/__tests__/quota.test.ts
 *
 * Unit tests for lib/quota.ts logic.
 * DB is mocked — no live Postgres needed.
 *
 * Limits import from the source so a bump-only edit doesn't require
 * touching every assertion. The exact-boundary cases (== limit, > limit)
 * are what we actually want to lock in.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  one:  vi.fn(),
  exec: vi.fn(),
  query: vi.fn(),
}));

import * as db from '@/lib/db';
const mockOne = db.one as MockedFunction<typeof db.one>;

import { checkAndIncrement, LIMITS } from '@/lib/quota';

describe('checkAndIncrement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows request when under free limit', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: 1 });
    const result = await checkAndIncrement('user_1', 'free');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1);
    expect(result.limit).toBe(LIMITS.free);
  });

  it('allows request when exactly at free limit', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: LIMITS.free });
    const result = await checkAndIncrement('user_1', 'free');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(LIMITS.free);
  });

  it('blocks request when over free limit', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: LIMITS.free + 1 });
    const result = await checkAndIncrement('user_1', 'free');
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(LIMITS.free + 1);
  });

  it('pro tier limit comes from LIMITS.pro', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: LIMITS.pro - 1 });
    const result = await checkAndIncrement('user_1', 'pro');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(LIMITS.pro);
  });

  it('pro tier blocks over its limit', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: LIMITS.pro + 1 });
    const result = await checkAndIncrement('user_1', 'pro');
    expect(result.allowed).toBe(false);
  });

  it('handles first query of day (DB returns null, defaults to 1)', async () => {
    mockOne.mockResolvedValueOnce(null);
    const result = await checkAndIncrement('user_1', 'free');
    expect(result.used).toBe(1);
    expect(result.allowed).toBe(true);
  });
});

describe('LIMITS', () => {
  // Lock in the actual values — a slip from intent (e.g. accidentally
  // pushing free=30 again) should fail CI loudly.
  it('free is 10', () => {
    expect(LIMITS.free).toBe(10);
  });

  it('pro is 30', () => {
    expect(LIMITS.pro).toBe(30);
  });

  it('pro > free (upgrade is meaningful)', () => {
    expect(LIMITS.pro).toBeGreaterThan(LIMITS.free);
  });
});
