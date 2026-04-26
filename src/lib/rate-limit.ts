/**
 * src/lib/rate-limit.ts
 *
 * Per-user min-interval limiter, backed by the rate_limits table.
 *
 * One UPSERT per call: on conflict the existing row's last_at is either
 * advanced to now() (cooldown elapsed → allowed) or left untouched
 * (rate-limited). The RETURNING clause reports both the verdict and the
 * remaining cooldown so handlers can set a Retry-After header.
 *
 * `now()` inside a single SQL statement is the transaction-start timestamp,
 * so comparing `last_at = now()` reliably tells us whether the row was
 * just refreshed.
 */

import { query } from './db';

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export async function rateLimit(
  userId: string,
  scope: string,
  cooldownSeconds: number,
): Promise<RateLimitResult> {
  const rows = await query<{ allowed: boolean; retry_after: number }>(
    `INSERT INTO rate_limits (user_id, scope, last_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, scope) DO UPDATE
       SET last_at = CASE
         WHEN rate_limits.last_at + make_interval(secs => $3) <= now() THEN now()
         ELSE rate_limits.last_at
       END
     RETURNING
       last_at = now() AS allowed,
       GREATEST(0,
         CEIL(EXTRACT(EPOCH FROM (last_at + make_interval(secs => $3) - now())))
       )::INT AS retry_after`,
    [userId, scope, cooldownSeconds],
  );

  const row = rows[0];
  if (!row || row.allowed) {
    return { allowed: true };
  }
  return { allowed: false, retryAfterSeconds: Math.max(1, row.retry_after) };
}
