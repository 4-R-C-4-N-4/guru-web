/**
 * src/__tests__/quota.test.ts
 *
 * Unit tests for lib/quota.ts logic.
 * DB is mocked — no live Postgres needed.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  one:  vi.fn(),
  exec: vi.fn(),
  query: vi.fn(),
}));

import * as db from '@/lib/db';
const mockOne = db.one as MockedFunction<typeof db.one>;

import { checkAndIncrement } from '@/lib/quota';

describe('checkAndIncrement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows request when under free limit (30)', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: 5 });
    const result = await checkAndIncrement('user_1', 'free');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(5);
    expect(result.limit).toBe(30);
  });

  it('allows request when exactly at free limit', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: 30 });
    const result = await checkAndIncrement('user_1', 'free');
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(30);
  });

  it('blocks request when over free limit', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: 31 });
    const result = await checkAndIncrement('user_1', 'free');
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(31);
  });

  it('pro tier has limit of 500', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: 499 });
    const result = await checkAndIncrement('user_1', 'pro');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(500);
  });

  it('pro tier blocks over 500', async () => {
    mockOne.mockResolvedValueOnce({ queries_used: 501 });
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
