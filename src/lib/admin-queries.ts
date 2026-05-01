/**
 * src/lib/admin-queries.ts
 *
 * SQL helpers shared by admin route handlers (overview, users,
 * sessions, queries). Keeps the route handlers thin and the SQL
 * grouped where it can be reviewed as a unit.
 *
 * Spec: BRD-admin-ui §1.5–§1.10. All read-only.
 *
 * Note on cost: every spend figure here is SUM(queries.cost_usd) over
 * the relevant window. Never recomputed from token counts × current
 * rates — that would mis-cost historical periods across price changes
 * (BRD §1.5).
 */

import { one, query } from './db';

// ── Types ────────────────────────────────────────────────────────────

export interface OverviewStats {
  users_total: number;
  users_new_30d: number;
  users_active_7d: number;
  pro_count: number;
  free_count: number;
  queries_today: number;
  queries_this_week: number;
  queries_this_month: number;
  spend_today_pro: number;
  spend_today_free: number;
  spend_week_pro: number;
  spend_week_free: number;
  spend_month_pro: number;
  spend_month_free: number;
  spend_mtd_total: number;
  spend_mtd_projection: number;
  active_rate_limits: number;
  users_at_budget_risk: number;
}

export interface DayPoint {
  /** YYYY-MM-DD */
  date: string;
  pro_value: number;
  free_value: number;
}

export interface TopUserRow {
  user_id: string;
  email: string;
  spend_this_week: number;
  spend_prior_week: number;
  queries_this_week: number;
}

export interface TopSessionRow {
  session_id: string;
  user_email: string;
  title: string | null;
  spend_this_week: number;
  query_count: number;
}

// ── Time helpers (server-side, UTC) ──────────────────────────────────

/**
 * MTD spend projection = (MTD spend / days_elapsed) × days_in_month.
 * BRD §1.5: simple linear extrapolation. Week-1 numbers swing wildly,
 * late-month converges. The projection is the early-warning signal,
 * not a forecast.
 */
export function projectMtd(mtdSpend: number, now: Date = new Date()): number {
  const day = now.getUTCDate();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  // Day 0 of next month = last day of current month.
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (day === 0) return 0;
  return (mtdSpend / day) * daysInMonth;
}

// ── Aggregations ─────────────────────────────────────────────────────

/**
 * Single round-trip for the stat tile row. SQL is one big SELECT with
 * sub-selects rather than 14 separate queries — at this scale (10s of
 * users, 1000s of queries) it's well under 50ms and one round trip
 * keeps the route simple.
 */
export async function fetchOverviewStats(): Promise<OverviewStats> {
  const row = await one<Record<string, string | number>>(
    `
    SELECT
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL)                                                      AS users_total,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days')         AS users_new_30d,
      (SELECT COUNT(DISTINCT user_id) FROM queries WHERE created_at >= now() - interval '7 days')                AS users_active_7d,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND tier = 'pro')                                     AS pro_count,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND tier = 'free')                                    AS free_count,
      (SELECT COUNT(*) FROM queries WHERE created_at >= date_trunc('day',   now() AT TIME ZONE 'UTC'))           AS queries_today,
      (SELECT COUNT(*) FROM queries WHERE created_at >= date_trunc('week',  now() AT TIME ZONE 'UTC'))           AS queries_this_week,
      (SELECT COUNT(*) FROM queries WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC'))           AS queries_this_month,
      (SELECT COALESCE(SUM(cost_usd),0) FROM queries WHERE tier_used = 'pro'  AND created_at >= date_trunc('day',   now() AT TIME ZONE 'UTC'))  AS spend_today_pro,
      (SELECT COALESCE(SUM(cost_usd),0) FROM queries WHERE tier_used = 'free' AND created_at >= date_trunc('day',   now() AT TIME ZONE 'UTC'))  AS spend_today_free,
      (SELECT COALESCE(SUM(cost_usd),0) FROM queries WHERE tier_used = 'pro'  AND created_at >= date_trunc('week',  now() AT TIME ZONE 'UTC'))  AS spend_week_pro,
      (SELECT COALESCE(SUM(cost_usd),0) FROM queries WHERE tier_used = 'free' AND created_at >= date_trunc('week',  now() AT TIME ZONE 'UTC'))  AS spend_week_free,
      (SELECT COALESCE(SUM(cost_usd),0) FROM queries WHERE tier_used = 'pro'  AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC'))  AS spend_month_pro,
      (SELECT COALESCE(SUM(cost_usd),0) FROM queries WHERE tier_used = 'free' AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC'))  AS spend_month_free,
      (SELECT COUNT(*) FROM rate_limits WHERE last_at > now() - interval '5 minutes')                            AS active_rate_limits,
      (SELECT COUNT(*) FROM user_budgets
        WHERE (query_limit IS NOT NULL AND query_limit > 0 AND queries_used::float / query_limit > 0.8)
           OR (usd_limit  IS NOT NULL AND usd_limit  > 0 AND usd_used::float    / usd_limit  > 0.8))             AS users_at_budget_risk
    `,
  );

  if (!row) {
    // Empty database — return zeros rather than throwing.
    return zeroStats();
  }

  const n = (k: string) => Number(row[k] ?? 0);
  const spend_mtd_total = n('spend_month_pro') + n('spend_month_free');

  return {
    users_total:          n('users_total'),
    users_new_30d:        n('users_new_30d'),
    users_active_7d:      n('users_active_7d'),
    pro_count:            n('pro_count'),
    free_count:           n('free_count'),
    queries_today:        n('queries_today'),
    queries_this_week:    n('queries_this_week'),
    queries_this_month:   n('queries_this_month'),
    spend_today_pro:      n('spend_today_pro'),
    spend_today_free:     n('spend_today_free'),
    spend_week_pro:       n('spend_week_pro'),
    spend_week_free:      n('spend_week_free'),
    spend_month_pro:      n('spend_month_pro'),
    spend_month_free:     n('spend_month_free'),
    spend_mtd_total,
    spend_mtd_projection: projectMtd(spend_mtd_total),
    active_rate_limits:   n('active_rate_limits'),
    users_at_budget_risk: n('users_at_budget_risk'),
  };
}

function zeroStats(): OverviewStats {
  return {
    users_total: 0, users_new_30d: 0, users_active_7d: 0,
    pro_count: 0,  free_count: 0,
    queries_today: 0, queries_this_week: 0, queries_this_month: 0,
    spend_today_pro: 0, spend_today_free: 0,
    spend_week_pro: 0,  spend_week_free: 0,
    spend_month_pro: 0, spend_month_free: 0,
    spend_mtd_total: 0, spend_mtd_projection: 0,
    active_rate_limits: 0, users_at_budget_risk: 0,
  };
}

/**
 * 30-day day-by-day series, stacked by tier. One row per day in the
 * window, even days with zero rows in queries (so the sparkline shows
 * gaps as gaps, not "compressed" gridlines).
 *
 * `metric` chooses which value gets summed: 'count' or 'spend'.
 */
export async function fetchDailySeries(
  metric: 'count' | 'spend',
  days = 30,
): Promise<DayPoint[]> {
  const expr = metric === 'count' ? 'COUNT(*)' : 'COALESCE(SUM(cost_usd),0)';

  const rows = await query<{
    date: string;
    pro_value: string | number;
    free_value: string | number;
  }>(
    `
    WITH days AS (
      SELECT generate_series(
        (now() AT TIME ZONE 'UTC')::date - ($1::int - 1),
        (now() AT TIME ZONE 'UTC')::date,
        interval '1 day'
      )::date AS d
    ),
    pro AS (
      SELECT (created_at AT TIME ZONE 'UTC')::date AS d, ${expr} AS v
        FROM queries WHERE tier_used = 'pro' AND created_at >= now() - ($1::int || ' days')::interval
        GROUP BY 1
    ),
    free AS (
      SELECT (created_at AT TIME ZONE 'UTC')::date AS d, ${expr} AS v
        FROM queries WHERE tier_used = 'free' AND created_at >= now() - ($1::int || ' days')::interval
        GROUP BY 1
    )
    SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
           COALESCE(pro.v, 0)            AS pro_value,
           COALESCE(free.v, 0)           AS free_value
      FROM days
      LEFT JOIN pro  ON pro.d  = days.d
      LEFT JOIN free ON free.d = days.d
      ORDER BY days.d ASC
    `,
    [days],
  );

  return rows.map((r) => ({
    date:       r.date,
    pro_value:  Number(r.pro_value),
    free_value: Number(r.free_value),
  }));
}

/** Top users by spend this week, with prior-week comparison for trend. */
export async function fetchTopUsers(limit = 10): Promise<TopUserRow[]> {
  const rows = await query<{
    user_id: string;
    email: string;
    spend_this_week: string | number;
    spend_prior_week: string | number;
    queries_this_week: string | number;
  }>(
    `
    SELECT
      u.id AS user_id,
      u.email,
      COALESCE(SUM(CASE WHEN q.created_at >= date_trunc('week', now() AT TIME ZONE 'UTC') THEN q.cost_usd END), 0)            AS spend_this_week,
      COALESCE(SUM(CASE WHEN q.created_at >= date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days'
                         AND q.created_at <  date_trunc('week', now() AT TIME ZONE 'UTC')         THEN q.cost_usd END), 0)    AS spend_prior_week,
      COUNT(CASE WHEN q.created_at >= date_trunc('week', now() AT TIME ZONE 'UTC') THEN 1 END)                                AS queries_this_week
      FROM users u
      LEFT JOIN queries q ON q.user_id = u.id
      WHERE u.deleted_at IS NULL
      GROUP BY u.id, u.email
      HAVING COALESCE(SUM(CASE WHEN q.created_at >= date_trunc('week', now() AT TIME ZONE 'UTC') THEN q.cost_usd END), 0) > 0
      ORDER BY spend_this_week DESC
      LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => ({
    user_id:           r.user_id,
    email:             r.email,
    spend_this_week:   Number(r.spend_this_week),
    spend_prior_week:  Number(r.spend_prior_week),
    queries_this_week: Number(r.queries_this_week),
  }));
}

/** Top sessions by spend this week, with owning user email. */
export async function fetchTopSessions(limit = 10): Promise<TopSessionRow[]> {
  const rows = await query<{
    session_id: string;
    user_email: string;
    title: string | null;
    spend_this_week: string | number;
    query_count: string | number;
  }>(
    `
    SELECT
      s.id           AS session_id,
      u.email        AS user_email,
      s.title        AS title,
      COALESCE(SUM(q.cost_usd), 0) AS spend_this_week,
      COUNT(q.id)                  AS query_count
      FROM sessions s
      JOIN users   u ON u.id = s.user_id
      JOIN queries q ON q.session_id = s.id
      WHERE q.created_at >= date_trunc('week', now() AT TIME ZONE 'UTC')
      GROUP BY s.id, u.email, s.title
      ORDER BY spend_this_week DESC
      LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => ({
    session_id:      r.session_id,
    user_email:      r.user_email,
    title:           r.title,
    spend_this_week: Number(r.spend_this_week),
    query_count:     Number(r.query_count),
  }));
}
