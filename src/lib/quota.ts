/**
 * src/lib/quota.ts
 *
 * Rate limit check + atomic increment.
 * Uses an upsert so a single round-trip both increments and returns the new count.
 */

import { one } from './db';

// Daily query caps per tier. Sized for cost coverage:
//   free  — 10 queries on deepseek/deepseek-chat (~free in absolute terms);
//           any more invites abuse with no upgrade path.
//   pro   — 30 queries on Claude Sonnet 4.5 (~$0.05 worst-case per query
//           at typical input/output sizes); caps worst-case at ~$1.50/day
//           per pro user vs $12/mo revenue.
//
// Single source of truth — imported by /api/quota for the display value.
export const LIMITS = { free: 10, pro: 30 } as const;

export async function checkAndIncrement(
  userId: string,
  tier: 'free' | 'pro'
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const today = new Date().toISOString().split('T')[0];
  const limit = LIMITS[tier];

  const row = await one<{ queries_used: number }>(
    `INSERT INTO quota_usage (user_id, date, queries_used)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, date)
     DO UPDATE SET queries_used = quota_usage.queries_used + 1
     RETURNING queries_used`,
    [userId, today]
  );

  const used = row?.queries_used ?? 1;
  return { allowed: used <= limit, used, limit };
}

export async function getUsageToday(
  userId: string
): Promise<{ used: number; limit: 'free' | 'pro' }> {
  const today = new Date().toISOString().split('T')[0];
  const row = await one<{ queries_used: number }>(
    `SELECT queries_used FROM quota_usage WHERE user_id = $1 AND date = $2`,
    [userId, today]
  );
  return { used: row?.queries_used ?? 0, limit: 'free' };
}
