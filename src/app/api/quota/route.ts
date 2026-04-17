/**
 * src/app/api/quota/route.ts
 *
 * GET /api/quota — return today's usage and limit for the current user.
 * Used by the frontend usage bar and chat input quota display.
 */

import { requireUser } from '@/lib/auth';
import { one } from '@/lib/db';

const LIMITS = { free: 30, pro: 500 } as const;

export async function GET() {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const today = new Date().toISOString().split('T')[0];
  const row = await one<{ queries_used: number }>(
    `SELECT queries_used FROM quota_usage WHERE user_id = $1 AND date = $2`,
    [user.id, today]
  );

  const used  = row?.queries_used ?? 0;
  const limit = LIMITS[user.tier] ?? LIMITS.free;

  return Response.json({ used, limit, tier: user.tier });
}
