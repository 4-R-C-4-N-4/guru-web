/**
 * src/app/api/admin/overview/route.ts
 *
 * GET /api/admin/overview — payload for the admin Overview dashboard.
 *
 * Spec: BRD-admin-ui §1.5, IMPL §4.
 *
 *   {
 *     stats:           OverviewStats,
 *     queries_per_day: DayPoint[],   // 30 entries, oldest → newest
 *     spend_per_day:   DayPoint[],   // 30 entries
 *     top_users:       TopUserRow[], // <=10
 *     top_sessions:    TopSessionRow[], // <=10
 *   }
 *
 * Returns 404 to non-admins (BRD §1.1). The middleware (src/middleware.ts)
 * already 404s non-admins before this handler runs; the requireAdmin()
 * check here is the third gate of defense in depth.
 */

import { requireAdmin } from '@/lib/admin';
import {
  fetchOverviewStats,
  fetchDailySeries,
  fetchTopUsers,
  fetchTopSessions,
} from '@/lib/admin-queries';

export async function GET() {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const [stats, queriesPerDay, spendPerDay, topUsers, topSessions] = await Promise.all([
    fetchOverviewStats(),
    fetchDailySeries('count'),
    fetchDailySeries('spend'),
    fetchTopUsers(),
    fetchTopSessions(),
  ]);

  return Response.json({
    stats,
    queries_per_day: queriesPerDay,
    spend_per_day:   spendPerDay,
    top_users:       topUsers,
    top_sessions:    topSessions,
  });
}
