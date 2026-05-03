/**
 * src/lib/spend.ts
 *
 * Dual-axis budget enforcement (todo:e8e441a8).
 *
 * Replaces lib/quota.ts:checkAndIncrement.  Two operations:
 *
 *   reserveBudget   — pre-flight: lazy period reset, then atomic
 *                     check-and-increment of queries_used + usd_used.
 *                     Rejects if either axis (when its limit is set)
 *                     would overrun; never partially increments.
 *
 *   finalizeBudget  — post-flight: adjust usd_used by (actual − estimated)
 *                     once the LLM reports its real token counts.
 *
 * Limits are tier-driven and rewritten on every reserveBudget call, so
 * a tier upgrade/downgrade takes effect on the next request without
 * any extra plumbing.  Either axis being null means unenforced.
 * The literal numbers live in src/lib/pricing-config.ts — bumping
 * the policy is a one-file edit there.
 *
 * Period reset is lazy (no cron): when reserveBudget reads a row whose
 * reset_at <= now(), it zeros both counters and bumps reset_at to the
 * next period boundary in UTC.  date_trunc happens in SQL so the
 * server's UTC timezone (per vps-bootstrap) is the single source of
 * truth.
 *
 * (File is named spend.ts because lib/budget.ts already owns
 * TokenBudget for prompt-assembly capacity — different concern.)
 */

import { exec, one } from './db';
import type { Tier } from './model';
import {
  FREE_DAILY_QUERY_LIMIT,
  PRO_DAILY_QUERY_LIMIT,
  PRO_DAILY_USD_CAP,
} from './pricing-config';

export interface BudgetState {
  queries_used: number;
  usd_used:     number;
  query_limit:  number | null;
  usd_limit:    number | null;
}

export interface ReserveResult extends BudgetState {
  allowed: boolean;
  reason?: 'queries' | 'usd';
}

export const TIER_LIMITS: Record<Tier, { query_limit: number | null; usd_limit: number | null }> = {
  free: { query_limit: FREE_DAILY_QUERY_LIMIT, usd_limit: null },
  // Pro: query_limit is a soft secondary gate against runaway loops;
  // usd_limit is the primary economic gate. Numbers derive from
  // pricing-config.ts — see BRD-model-selection.md §3.2 for the
  // per-model implications.
  pro:  { query_limit: PRO_DAILY_QUERY_LIMIT, usd_limit: PRO_DAILY_USD_CAP },
} as const;

const PERIOD = 'daily' as const;

// SQL fragment for "next period boundary in UTC". Server timezone is
// UTC so date_trunc operates in UTC; the result is a UTC timestamptz.
const NEXT_RESET_SQL = PERIOD === 'daily'
  ? `(date_trunc('day', now()) + interval '1 day')`
  : `(date_trunc('month', now()) + interval '1 month')`;

/**
 * Pre-flight reserve.  Inserts the budget row if missing, applies the
 * tier's current limits, lazily resets if the period elapsed, then
 * atomically increments both counters iff doing so wouldn't exceed
 * either non-null limit.  Returns { allowed: false, reason } and the
 * unchanged counters when rejected.
 */
export async function reserveBudget(args: {
  userId: string;
  tier: Tier;
  estimatedCostUsd: number;
}): Promise<ReserveResult> {
  const { userId, tier, estimatedCostUsd } = args;
  const limits = TIER_LIMITS[tier];

  // 1. Upsert: write current tier's limits, lazy-reset if reset_at has
  //    passed.  CASE expressions keep this single-statement and atomic.
  await exec(
    `INSERT INTO user_budgets
       (user_id, period, query_limit, usd_limit, queries_used, usd_used, reset_at)
     VALUES ($1, $2, $3, $4, 0, 0, ${NEXT_RESET_SQL})
     ON CONFLICT (user_id, period) DO UPDATE
       SET query_limit  = EXCLUDED.query_limit,
           usd_limit    = EXCLUDED.usd_limit,
           queries_used = CASE WHEN user_budgets.reset_at <= now()
                               THEN 0 ELSE user_budgets.queries_used END,
           usd_used     = CASE WHEN user_budgets.reset_at <= now()
                               THEN 0 ELSE user_budgets.usd_used END,
           reset_at     = CASE WHEN user_budgets.reset_at <= now()
                               THEN ${NEXT_RESET_SQL}
                               ELSE user_budgets.reset_at END`,
    [userId, PERIOD, limits.query_limit, limits.usd_limit],
  );

  // 2. Atomic check + increment.  WHERE clause excludes overruns; an
  //    empty RETURNING means we hit a limit.
  const updated = await one<RawBudgetRow>(
    `UPDATE user_budgets
     SET queries_used = queries_used + 1,
         usd_used     = usd_used + $3
     WHERE user_id = $1 AND period = $2
       AND (query_limit IS NULL OR queries_used + 1 <= query_limit)
       AND (usd_limit   IS NULL OR usd_used + $3 <= usd_limit)
     RETURNING queries_used, usd_used, query_limit, usd_limit`,
    [userId, PERIOD, estimatedCostUsd],
  );
  if (updated) return { allowed: true, ...coerce(updated) };

  // 3. Rejected — read state separately to attribute the reason.
  const current = await one<RawBudgetRow>(
    `SELECT queries_used, usd_used, query_limit, usd_limit
     FROM user_budgets WHERE user_id = $1 AND period = $2`,
    [userId, PERIOD],
  );
  const state: BudgetState = current ? coerce(current) : {
    queries_used: 0, usd_used: 0,
    query_limit: limits.query_limit, usd_limit: limits.usd_limit,
  };

  let reason: 'queries' | 'usd' | undefined;
  if (state.query_limit !== null && state.queries_used + 1 > state.query_limit) {
    reason = 'queries';
  } else if (state.usd_limit !== null && state.usd_used + estimatedCostUsd > state.usd_limit) {
    reason = 'usd';
  }
  return { allowed: false, ...state, reason };
}

/**
 * Post-flight reconciliation.  Adjusts usd_used by (actual − estimated).
 * Usually negative because reserveBudget priced the worst case; when
 * actual > estimated (provider exceeded the cap, rare), the overage is
 * recorded but doesn't trigger a follow-up rejection — the request
 * already happened.
 */
export async function finalizeBudget(args: {
  userId: string;
  estimatedCostUsd: number;
  actualCostUsd: number;
}): Promise<void> {
  const delta = args.actualCostUsd - args.estimatedCostUsd;
  if (delta === 0) return;
  await exec(
    `UPDATE user_budgets
     SET usd_used = GREATEST(0, usd_used + $3)
     WHERE user_id = $1 AND period = $2`,
    [args.userId, PERIOD, delta],
  );
}

/** Read current budget without mutating (for /api/quota). */
export async function getBudget(userId: string, tier: Tier): Promise<BudgetState> {
  const row = await one<RawBudgetRow>(
    `SELECT queries_used, usd_used, query_limit, usd_limit
     FROM user_budgets WHERE user_id = $1 AND period = $2`,
    [userId, PERIOD],
  );
  if (row) return coerce(row);
  // No row yet — tier defaults with zero usage.
  const limits = TIER_LIMITS[tier];
  return {
    queries_used: 0, usd_used: 0,
    query_limit: limits.query_limit, usd_limit: limits.usd_limit,
  };
}

// ── helpers ──────────────────────────────────────────────────────────

interface RawBudgetRow {
  queries_used: number;
  usd_used:     string | number;
  query_limit:  number | null;
  usd_limit:    string | number | null;
}

function coerce(r: RawBudgetRow): BudgetState {
  return {
    queries_used: Number(r.queries_used),
    usd_used:     Number(r.usd_used),
    query_limit:  r.query_limit,
    usd_limit:    r.usd_limit === null ? null : Number(r.usd_limit),
  };
}
