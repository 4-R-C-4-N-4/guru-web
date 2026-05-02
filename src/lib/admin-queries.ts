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

// ── Users list + deep dive ───────────────────────────────────────────

export interface UserListFilters {
  tier?: 'free' | 'pro' | 'all';
  /** ISO date string. Users with created_at >= this. */
  createdAfter?: string | null;
  /** Has queried in the last N days. 0 = "today" (since UTC midnight), -1 = "never". */
  queriedWithinDays?: number | null;
  search?: string | null;
}

export interface UserListSort {
  by: 'email' | 'created_at' | 'last_query_at' | 'queries_7d' | 'spend_7d';
  dir: 'asc' | 'desc';
}

export interface UserListRow {
  id: string;
  email: string;
  tier: 'free' | 'pro';
  stripe_customer_id: string | null;
  created_at: string;
  last_query_at: string | null;
  queries_7d: number;
  spend_7d: number;
}

const SORT_COLUMNS: Record<UserListSort['by'], string> = {
  email:         'u.email',
  created_at:    'u.created_at',
  last_query_at: 'last_query_at',
  queries_7d:    'queries_7d',
  spend_7d:      'spend_7d',
};

/**
 * Build the WHERE / ORDER BY clauses for the user-list query. Returns
 * the SQL fragments and the param array. Exported so the JSON list
 * route, the count, and the streaming CSV route share identical shape.
 */
export function buildUserListSql(
  filters: UserListFilters,
  sort: UserListSort,
): { joinSql: string; whereSql: string; orderSql: string; params: unknown[] } {
  const params: unknown[] = [];
  const where: string[] = ['u.deleted_at IS NULL'];

  if (filters.tier && filters.tier !== 'all') {
    params.push(filters.tier);
    where.push(`u.tier = $${params.length}`);
  }
  if (filters.createdAfter) {
    params.push(filters.createdAfter);
    where.push(`u.created_at >= $${params.length}::timestamptz`);
  }
  if (typeof filters.queriedWithinDays === 'number' && filters.queriedWithinDays >= 0) {
    params.push(filters.queriedWithinDays);
    where.push(`last_query_at >= now() - ($${params.length}::int || ' days')::interval`);
  } else if (filters.queriedWithinDays === -1) {
    where.push(`last_query_at IS NULL`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`u.email ILIKE $${params.length}`);
  }

  const joinSql = `
    LEFT JOIN LATERAL (
      SELECT
        MAX(q.created_at)                                                                    AS last_query_at,
        COUNT(CASE WHEN q.created_at >= now() - interval '7 days' THEN 1 END)                AS queries_7d,
        COALESCE(SUM(CASE WHEN q.created_at >= now() - interval '7 days' THEN q.cost_usd END), 0) AS spend_7d
      FROM queries q
      WHERE q.user_id = u.id
    ) qstats ON true
  `;
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql = `ORDER BY ${SORT_COLUMNS[sort.by]} ${sort.dir.toUpperCase()} NULLS LAST`;

  return { joinSql, whereSql, orderSql, params };
}

/** Total matching count (for pagination footer). */
export async function countUsers(filters: UserListFilters): Promise<number> {
  const { joinSql, whereSql, params } = buildUserListSql(filters, { by: 'email', dir: 'asc' });
  const row = await one<{ n: string | number }>(
    `SELECT COUNT(*)::int AS n FROM users u ${joinSql} ${whereSql}`,
    params,
  );
  return Number(row?.n ?? 0);
}

/** Paginated list. */
export async function listUsers(
  filters: UserListFilters,
  sort: UserListSort,
  page: number,
  pageSize: number,
): Promise<UserListRow[]> {
  const { joinSql, whereSql, orderSql, params } = buildUserListSql(filters, sort);
  const offset = page * pageSize;
  params.push(pageSize, offset);

  const rows = await query<{
    id: string; email: string; tier: 'free' | 'pro';
    stripe_customer_id: string | null;
    created_at: string;
    last_query_at: string | null;
    queries_7d: string | number;
    spend_7d:   string | number;
  }>(
    `SELECT u.id, u.email, u.tier, u.stripe_customer_id, u.created_at,
            qstats.last_query_at, qstats.queries_7d, qstats.spend_7d
       FROM users u
       ${joinSql}
       ${whereSql}
       ${orderSql}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    tier: r.tier,
    stripe_customer_id: r.stripe_customer_id,
    created_at: r.created_at,
    last_query_at: r.last_query_at,
    queries_7d: Number(r.queries_7d),
    spend_7d:   Number(r.spend_7d),
  }));
}

// ── User deep dive ───────────────────────────────────────────────────

export interface UserBudget {
  period:      'daily' | 'monthly';
  query_limit: number | null;
  queries_used: number;
  usd_limit:    number | null;
  usd_used:     number;
}

export interface UserPreferencesSnapshot {
  scope_mode: string;
  blocked_traditions: string[];
  blocked_texts: string[];
  whitelisted_traditions: string[];
  whitelisted_texts: string[];
  updated_at: string;
}

export interface UserDeepDive {
  user: {
    id: string;
    email: string;
    tier: 'free' | 'pro';
    stripe_customer_id: string | null;
    created_at: string;
  };
  /** Account age in whole days, computed server-side at fetch time
   *  so the page render stays pure (no Date.now() during render). */
  account_age_days: number;
  lifetime: {
    queries: number;
    spend:   number;
    input_tokens:  number;
    output_tokens: number;
  };
  budgets: UserBudget[];
  preferences: UserPreferencesSnapshot | null;
  rate_limits: { scope: string; last_at: string }[];
}

export async function getUserDeepDive(userId: string): Promise<UserDeepDive | null> {
  const user = await one<UserDeepDive['user']>(
    `SELECT id, email, tier, stripe_customer_id, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!user) return null;

  const lifetime = await one<{
    queries: string | number;
    spend:   string | number;
    input_tokens: string | number;
    output_tokens: string | number;
  }>(
    `SELECT COUNT(*)                                AS queries,
            COALESCE(SUM(cost_usd), 0)              AS spend,
            COALESCE(SUM(input_tokens), 0)          AS input_tokens,
            COALESCE(SUM(output_tokens), 0)         AS output_tokens
       FROM queries WHERE user_id = $1`,
    [userId],
  );

  const budgets = await query<UserBudget & { usd_limit: string | number | null; usd_used: string | number }>(
    `SELECT period, query_limit, queries_used, usd_limit, usd_used
       FROM user_budgets WHERE user_id = $1`,
    [userId],
  );

  const preferences = await one<UserPreferencesSnapshot>(
    `SELECT scope_mode, blocked_traditions, blocked_texts,
            whitelisted_traditions, whitelisted_texts, updated_at
       FROM user_preferences WHERE user_id = $1`,
    [userId],
  );

  const rateLimits = await query<{ scope: string; last_at: string }>(
    `SELECT scope, last_at FROM rate_limits
       WHERE user_id = $1 AND last_at > now() - interval '24 hours'
       ORDER BY last_at DESC`,
    [userId],
  );

  return {
    user,
    account_age_days: Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86_400_000),
    lifetime: {
      queries:       Number(lifetime?.queries ?? 0),
      spend:         Number(lifetime?.spend   ?? 0),
      input_tokens:  Number(lifetime?.input_tokens  ?? 0),
      output_tokens: Number(lifetime?.output_tokens ?? 0),
    },
    budgets: budgets.map((b) => ({
      period:       b.period,
      query_limit:  b.query_limit,
      queries_used: Number(b.queries_used),
      usd_limit:    b.usd_limit === null ? null : Number(b.usd_limit),
      usd_used:     Number(b.usd_used),
    })),
    preferences,
    rate_limits: rateLimits,
  };
}

export interface UserSessionRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  query_count: number;
  spend: number;
}

export async function listUserSessions(userId: string): Promise<UserSessionRow[]> {
  const rows = await query<{
    id: string; title: string | null;
    created_at: string; updated_at: string;
    query_count: string | number;
    spend: string | number;
  }>(
    `SELECT s.id, s.title, s.created_at, s.updated_at,
            COUNT(q.id)                       AS query_count,
            COALESCE(SUM(q.cost_usd), 0)      AS spend
       FROM sessions s
       LEFT JOIN queries q ON q.session_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.updated_at DESC`,
    [userId],
  );

  return rows.map((r) => ({
    id: r.id, title: r.title,
    created_at: r.created_at, updated_at: r.updated_at,
    query_count: Number(r.query_count),
    spend:       Number(r.spend),
  }));
}

// ── Session + Query deep dives ───────────────────────────────────────

export interface SessionQueryRow {
  id: string;
  query_text: string;
  response_text: string;
  chunks_used: unknown;            // JSONB; structure depends on retriever
  model_used: string;
  tier_used: 'free' | 'pro';
  input_tokens: number  | null;
  output_tokens: number | null;
  cached_input_tokens: number;
  cost_usd: number | null;
  created_at: string;
  pricing_input_per_mtok:        number | null;
  pricing_output_per_mtok:       number | null;
  pricing_cached_input_per_mtok: number | null;
  pricing_effective_from:        string | null;
}

export interface SessionDeepDive {
  session: {
    id: string;
    title: string | null;
    user_id: string;
    user_email: string;
    created_at: string;
    updated_at: string;
  };
  totals: {
    query_count: number;
    spend: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
  };
  queries: SessionQueryRow[];
}

/**
 * Pull a session, its owner's email, all per-query rows, and for each
 * query the model_pricing row that was active at the query's
 * created_at. The model_pricing JOIN uses a LATERAL subquery so each
 * row picks its own effective price.
 */
export async function getSessionDeepDive(sessionId: string): Promise<SessionDeepDive | null> {
  const session = await one<{
    id: string;
    title: string | null;
    user_id: string;
    user_email: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT s.id, s.title, s.user_id, u.email AS user_email, s.created_at, s.updated_at
       FROM sessions s
       JOIN users    u ON u.id = s.user_id
       WHERE s.id = $1`,
    [sessionId],
  );
  if (!session) return null;

  const queries = await query<SessionQueryRow & {
    input_tokens: string | number | null;
    output_tokens: string | number | null;
    cached_input_tokens: string | number;
    cost_usd: string | number | null;
    pricing_input_per_mtok: string | number | null;
    pricing_output_per_mtok: string | number | null;
    pricing_cached_input_per_mtok: string | number | null;
  }>(
    `SELECT q.id, q.query_text, q.response_text, q.chunks_used,
            q.model_used, q.tier_used,
            q.input_tokens, q.output_tokens, q.cached_input_tokens,
            q.cost_usd, q.created_at,
            mp.input_price_per_mtok        AS pricing_input_per_mtok,
            mp.output_price_per_mtok       AS pricing_output_per_mtok,
            mp.cached_input_price_per_mtok AS pricing_cached_input_per_mtok,
            mp.effective_from              AS pricing_effective_from
       FROM queries q
       LEFT JOIN LATERAL (
         SELECT input_price_per_mtok, output_price_per_mtok,
                cached_input_price_per_mtok, effective_from
           FROM model_pricing
           WHERE model_id = q.model_used
             AND effective_from <= q.created_at
             AND (effective_to IS NULL OR effective_to > q.created_at)
           ORDER BY effective_from DESC LIMIT 1
       ) mp ON true
       WHERE q.session_id = $1
       ORDER BY q.created_at ASC`,
    [sessionId],
  );

  const normalised: SessionQueryRow[] = queries.map((q) => ({
    id: q.id,
    query_text: q.query_text,
    response_text: q.response_text,
    chunks_used: q.chunks_used,
    model_used: q.model_used,
    tier_used: q.tier_used,
    input_tokens:  q.input_tokens  === null ? null : Number(q.input_tokens),
    output_tokens: q.output_tokens === null ? null : Number(q.output_tokens),
    cached_input_tokens: Number(q.cached_input_tokens),
    cost_usd: q.cost_usd === null ? null : Number(q.cost_usd),
    created_at: q.created_at,
    pricing_input_per_mtok:        q.pricing_input_per_mtok  === null ? null : Number(q.pricing_input_per_mtok),
    pricing_output_per_mtok:       q.pricing_output_per_mtok === null ? null : Number(q.pricing_output_per_mtok),
    pricing_cached_input_per_mtok: q.pricing_cached_input_per_mtok === null ? null : Number(q.pricing_cached_input_per_mtok),
    pricing_effective_from:        q.pricing_effective_from,
  }));

  const totals = normalised.reduce(
    (acc, q) => ({
      query_count: acc.query_count + 1,
      spend:               acc.spend + (q.cost_usd ?? 0),
      input_tokens:        acc.input_tokens  + (q.input_tokens  ?? 0),
      output_tokens:       acc.output_tokens + (q.output_tokens ?? 0),
      cached_input_tokens: acc.cached_input_tokens + q.cached_input_tokens,
    }),
    { query_count: 0, spend: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 },
  );

  return { session, totals, queries: normalised };
}

export interface QueryDeepDive {
  query: SessionQueryRow & {
    session_id: string;
    user_id: string;
    user_email: string;
  };
  /** The DB row exactly, JSON-serialised. Used by the "raw JSON" toggle. */
  raw: Record<string, unknown>;
}

export async function getQueryDeepDive(queryId: string): Promise<QueryDeepDive | null> {
  const row = await one<Record<string, unknown> & {
    id: string;
    session_id: string;
    user_id: string;
    user_email: string;
    query_text: string;
    response_text: string;
    chunks_used: unknown;
    model_used: string;
    tier_used: 'free' | 'pro';
    input_tokens: string | number | null;
    output_tokens: string | number | null;
    cached_input_tokens: string | number;
    cost_usd: string | number | null;
    created_at: string;
    pricing_input_per_mtok: string | number | null;
    pricing_output_per_mtok: string | number | null;
    pricing_cached_input_per_mtok: string | number | null;
    pricing_effective_from: string | null;
  }>(
    `SELECT q.id, q.session_id, q.user_id, u.email AS user_email,
            q.query_text, q.response_text, q.chunks_used,
            q.model_used, q.tier_used,
            q.input_tokens, q.output_tokens, q.cached_input_tokens,
            q.cost_usd, q.created_at,
            mp.input_price_per_mtok        AS pricing_input_per_mtok,
            mp.output_price_per_mtok       AS pricing_output_per_mtok,
            mp.cached_input_price_per_mtok AS pricing_cached_input_per_mtok,
            mp.effective_from              AS pricing_effective_from
       FROM queries q
       JOIN users    u ON u.id = q.user_id
       LEFT JOIN LATERAL (
         SELECT input_price_per_mtok, output_price_per_mtok,
                cached_input_price_per_mtok, effective_from
           FROM model_pricing
           WHERE model_id = q.model_used
             AND effective_from <= q.created_at
             AND (effective_to IS NULL OR effective_to > q.created_at)
           ORDER BY effective_from DESC LIMIT 1
       ) mp ON true
       WHERE q.id = $1`,
    [queryId],
  );
  if (!row) return null;

  const query: QueryDeepDive['query'] = {
    id: row.id,
    session_id: row.session_id,
    user_id: row.user_id,
    user_email: row.user_email,
    query_text: row.query_text,
    response_text: row.response_text,
    chunks_used: row.chunks_used,
    model_used: row.model_used,
    tier_used: row.tier_used,
    input_tokens:  row.input_tokens  === null ? null : Number(row.input_tokens),
    output_tokens: row.output_tokens === null ? null : Number(row.output_tokens),
    cached_input_tokens: Number(row.cached_input_tokens),
    cost_usd: row.cost_usd === null ? null : Number(row.cost_usd),
    created_at: row.created_at,
    pricing_input_per_mtok:        row.pricing_input_per_mtok  === null ? null : Number(row.pricing_input_per_mtok),
    pricing_output_per_mtok:       row.pricing_output_per_mtok === null ? null : Number(row.pricing_output_per_mtok),
    pricing_cached_input_per_mtok: row.pricing_cached_input_per_mtok === null ? null : Number(row.pricing_cached_input_per_mtok),
    pricing_effective_from:        row.pricing_effective_from,
  };

  return { query, raw: row };
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
