/**
 * src/app/api/quota/route.ts
 *
 * GET /api/quota — return today's budget for the current user.
 *
 * Response shape (todo:7c8fdae7):
 *   {
 *     tier:         'free' | 'pro',
 *     queries_used: number,
 *     query_limit:  number | null,    // null = unenforced on this axis
 *     usd_used:     number,
 *     usd_limit:    number | null,
 *   }
 *
 * Backwards-compatible aliases `used` and `limit` (today's frontend
 * reads these) keep mirroring the queries axis until a separate UI
 * ticket switches the display to dollars.
 */

import { requireUser } from '@/lib/auth';
import { getBudget } from '@/lib/spend';

export async function GET() {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const budget = await getBudget(user.id, user.tier);
  return Response.json({
    tier: user.tier,
    queries_used: budget.queries_used,
    query_limit:  budget.query_limit,
    usd_used:     budget.usd_used,
    usd_limit:    budget.usd_limit,
    // Backwards-compat: today's UI reads `used`/`limit`. These mirror
    // the queries axis. Drop after the UI flips to dollars.
    used:  budget.queries_used,
    limit: budget.query_limit,
  });
}
