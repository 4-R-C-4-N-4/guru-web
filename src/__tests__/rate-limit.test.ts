/**
 * src/__tests__/rate-limit.test.ts
 *
 * Unit tests for the per-user min-interval rate limiter.
 * The DB layer is mocked; we exercise the helper's branching on the
 * RETURNING shape produced by the UPSERT.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  one:   vi.fn(),
  exec:  vi.fn(),
}));

import * as db from '@/lib/db';
const mockQuery = db.query as MockedFunction<typeof db.query>;

const { rateLimit } = await import('@/lib/rate-limit');

describe('rateLimit()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows when the UPSERT advances last_at to now()', async () => {
    mockQuery.mockResolvedValueOnce([{ allowed: true, retry_after: 0 }]);

    const result = await rateLimit('user_1', 'query', 1);
    expect(result).toEqual({ allowed: true });
  });

  it('denies and surfaces retryAfterSeconds when cooldown is active', async () => {
    mockQuery.mockResolvedValueOnce([{ allowed: false, retry_after: 4 }]);

    const result = await rateLimit('user_1', 'checkout', 300);
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 4 });
  });

  it('floors retryAfterSeconds at 1 so Retry-After never reads as 0 when denied', async () => {
    // Race: row exists but row's CEIL gave us 0 (sub-second remainder).
    mockQuery.mockResolvedValueOnce([{ allowed: false, retry_after: 0 }]);

    const result = await rateLimit('user_1', 'query', 1);
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('passes scope and cooldown through to the SQL parameters', async () => {
    mockQuery.mockResolvedValueOnce([{ allowed: true, retry_after: 0 }]);

    await rateLimit('user_xyz', 'checkout', 300);
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain('rate_limits');
    expect(sql).toContain('ON CONFLICT');
    expect(params).toEqual(['user_xyz', 'checkout', 300]);
  });
});
