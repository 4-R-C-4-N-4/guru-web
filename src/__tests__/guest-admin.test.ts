/**
 * src/__tests__/guest-admin.test.ts
 *
 * Admin guest aggregates + list (todo:85125f9e). Asserts the SQL shape
 * (guest bucket keyed on tier_used='guest'; authed counts exclude
 * unconverted guests) and the row mapping. db is mocked.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import * as db from '@/lib/db';
import { fetchOverviewStats, fetchDailySeries, fetchGuestQueries, fetchGuestCount } from '@/lib/admin-queries';

const mockOne   = db.one   as MockedFunction<typeof db.one>;
const mockQuery = db.query as MockedFunction<typeof db.query>;

beforeEach(() => vi.clearAllMocks());

describe('fetchOverviewStats — guest bucket', () => {
  it('exposes guest spend/counts and excludes unconverted guests from authed counts', async () => {
    mockOne.mockResolvedValueOnce({
      users_total: 1, users_new_30d: 0, users_active_7d: 1,
      pro_count: 0, free_count: 1,
      queries_today: 3, queries_this_week: 3, queries_this_month: 3,
      spend_today_pro: 0, spend_today_free: 0.01,
      spend_week_pro: 0, spend_week_free: 0.01,
      spend_month_pro: 0, spend_month_free: 0.01,
      spend_today_guest: 0.02, spend_week_guest: 0.05, spend_month_guest: 0.09,
      guest_queries_today: 2, guest_queries_this_week: 5, guest_queries_this_month: 9,
      active_rate_limits: 0, users_at_budget_risk: 0,
    });

    const stats = await fetchOverviewStats();
    expect(stats.spend_today_guest).toBe(0.02);
    expect(stats.guest_queries_today).toBe(2);
    expect(stats.guest_queries_this_month).toBe(9);
    // MTD total is the operator's real bill — it includes the guest bucket
    // (spend_month_pro 0 + free 0.01 + guest 0.09). Review finding #2.
    expect(stats.spend_mtd_total).toBeCloseTo(0.10, 5);

    const sql = mockOne.mock.calls[0]![0] as string;
    // Guest spend + count buckets present.
    expect(sql).toMatch(/tier_used = 'guest'/);
    // Authed query counts guard against unconverted guests.
    expect(sql).toMatch(/user_id IS NOT NULL AND created_at >= date_trunc\('day'/);
  });
});

describe('fetchDailySeries — guest series', () => {
  it('adds a guest_value column and maps it', async () => {
    mockQuery.mockResolvedValueOnce([{ date: '2026-09-07', pro_value: 0, free_value: 1, guest_value: 3 }]);
    const series = await fetchDailySeries('count');
    expect(series[0]).toEqual({ date: '2026-09-07', pro_value: 0, free_value: 1, guest_value: 3 });
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/guest AS \(/);
    expect(sql).toMatch(/tier_used = 'guest'/);
  });
});

describe('fetchGuestQueries / fetchGuestCount', () => {
  it('lists only unconverted guest rows, newest first, and maps numbers', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 'q1', ip_name: 'curious-ibis', guest_ip: '203.0.113.9',
      query_text: 'What is gnosis?', response_text: 'A long answer.',
      model_used: 'deepseek/deepseek-v4-pro',
      input_tokens: '120', output_tokens: '40', cost_usd: '0.0021',
      created_at: '2026-09-07T10:00:00Z',
    }]);

    const rows = await fetchGuestQueries(50, 10);
    expect(rows[0]).toMatchObject({
      id: 'q1', ip_name: 'curious-ibis', guest_ip: '203.0.113.9',
      input_tokens: 120, output_tokens: 40, cost_usd: 0.0021,
    });
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toMatch(/WHERE tier_used = 'guest' AND user_id IS NULL/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params).toEqual([50, 10]);
  });

  it('counts unconverted guest rows', async () => {
    mockOne.mockResolvedValueOnce({ n: '7' });
    expect(await fetchGuestCount()).toBe(7);
    const sql = mockOne.mock.calls[0]![0] as string;
    expect(sql).toMatch(/COUNT\(\*\)[\s\S]*tier_used = 'guest' AND user_id IS NULL/);
  });
});
