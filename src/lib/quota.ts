/**
 * src/lib/quota.ts
 *
 * Rate limit check + atomic increment.
 * Uses an upsert so a single round-trip both increments and returns the new count.
 */

import { one } from './db';

const LIMITS = { free: 30, pro: 500 } as const;

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
