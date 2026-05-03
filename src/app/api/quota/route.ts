/**
 * src/app/api/quota/route.ts
 *
 * GET /api/quota — return today's question count for the current user.
 *
 * Response shape (todo:e8105324 reframe):
 *   {
 *     tier:         'free' | 'pro',
 *     queries_used: number,
 *     query_limit:  number | null,    // null = unenforced on this axis
 *
 *     // Backwards-compat aliases for the existing chat-view header.
 *     used:  number,                  // mirrors queries_used
 *     limit: number | null,           // mirrors query_limit
 *   }
 *
 * Spend axis (`usd_used`, `usd_limit`) is deliberately omitted from
 * this client-facing endpoint. The USD cap still enforces server-side
 * via reserveBudget; admin endpoints (/api/admin/users/[id]) surface
 * the dollar figures for the operator. Users see questions, not
 * dollars (todo:e8105324).
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
    // Backwards-compat aliases — chat-view header reads these.
    used:  budget.queries_used,
    limit: budget.query_limit,
  });
}
