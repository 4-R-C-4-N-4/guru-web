/**
 * src/__tests__/admin-overview.test.ts
 *
 * Endpoint contract test for GET /api/admin/overview, plus the pure
 * MTD projection helper.
 *
 * Strategy:
 *   - Mock @/lib/admin so requireAdmin() is controllable per test.
 *   - Mock @/lib/admin-queries so we don't touch Postgres.
 *   - Assert: 404 to non-admins, JSON shape on success.
 *
 * Spec: BRD-admin-ui §1.5, IMPL §4.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(),
  isAdmin:      vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/admin-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-queries')>('@/lib/admin-queries');
  return {
    ...actual,
    fetchOverviewStats: vi.fn(),
    fetchDailySeries:   vi.fn(),
    fetchTopUsers:      vi.fn(),
    fetchTopSessions:   vi.fn(),
  };
});

import * as admin from '@/lib/admin';
import * as adminQ from '@/lib/admin-queries';
const mockRequireAdmin = admin.requireAdmin as MockedFunction<typeof admin.requireAdmin>;
const mockStats        = adminQ.fetchOverviewStats as MockedFunction<typeof adminQ.fetchOverviewStats>;
const mockSeries       = adminQ.fetchDailySeries   as MockedFunction<typeof adminQ.fetchDailySeries>;
const mockTopUsers     = adminQ.fetchTopUsers      as MockedFunction<typeof adminQ.fetchTopUsers>;
const mockTopSessions  = adminQ.fetchTopSessions   as MockedFunction<typeof adminQ.fetchTopSessions>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/overview', () => {
  it('returns 404 when requireAdmin fails', async () => {
    mockRequireAdmin.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const { GET } = await import('@/app/api/admin/overview/route');
    const res = await GET();
    expect(res.status).toBe(404);
    expect(mockStats).not.toHaveBeenCalled();
  });

  it('returns the full payload to an admin', async () => {
    mockRequireAdmin.mockResolvedValueOnce({
      id: 'user_admin', email: 'op@x', tier: 'pro', stripe_customer_id: null,
    });
    mockStats.mockResolvedValueOnce({
      users_total: 42, users_new_30d: 3, users_active_7d: 17,
      pro_count: 5, free_count: 37,
      queries_today: 100, queries_this_week: 700, queries_this_month: 2800,
      spend_today_pro: 1.2, spend_today_free: 0.1,
      spend_week_pro: 8.4, spend_week_free: 0.7,
      spend_month_pro: 32, spend_month_free: 2.1,
      spend_mtd_total: 34.1, spend_mtd_projection: 80,
      active_rate_limits: 0,
      users_at_budget_risk: 2,
    });
    mockSeries.mockResolvedValue([{ date: '2026-04-01', pro_value: 5, free_value: 1 }]);
    mockTopUsers.mockResolvedValueOnce([{
      user_id: 'u1', email: 'a@b.com',
      spend_this_week: 1.5, spend_prior_week: 0.8, queries_this_week: 12,
    }]);
    mockTopSessions.mockResolvedValueOnce([{
      session_id: 's1', user_email: 'a@b.com', title: 'thinking about logos',
      spend_this_week: 0.7, query_count: 4,
    }]);

    const { GET } = await import('@/app/api/admin/overview/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.users_total).toBe(42);
    expect(body.stats.spend_mtd_projection).toBe(80);
    expect(body.queries_per_day).toHaveLength(1);
    expect(body.spend_per_day).toHaveLength(1);
    expect(body.top_users[0].email).toBe('a@b.com');
    expect(body.top_sessions[0].title).toBe('thinking about logos');
  });
});

describe('projectMtd()', () => {
  it('linearly extrapolates MTD spend to month-end', async () => {
    const { projectMtd } = await import('@/lib/admin-queries');
    // Day 10 of a 30-day month: $10 spent so far → $30 EOM.
    const apr10 = new Date(Date.UTC(2026, 3, 10));
    expect(projectMtd(10, apr10)).toBeCloseTo(30, 5);
  });

  it('returns 0 when MTD spend is 0', async () => {
    const { projectMtd } = await import('@/lib/admin-queries');
    expect(projectMtd(0, new Date(Date.UTC(2026, 4, 15)))).toBe(0);
  });

  it('handles 31-day months', async () => {
    const { projectMtd } = await import('@/lib/admin-queries');
    // Day 1 of January (31 days), $1 spent: projection = $31.
    const jan1 = new Date(Date.UTC(2026, 0, 1));
    expect(projectMtd(1, jan1)).toBeCloseTo(31, 5);
  });
});
