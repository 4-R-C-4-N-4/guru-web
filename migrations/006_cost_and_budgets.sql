-- 006_cost_and_budgets.sql — additive cost tracking + dual-axis budgets.
--
-- Spec: todo:0d91fca3 (parent), todo:938740cb (this child).
--
-- All-additive: existing columns stay, no renames or aliases.
-- queries.cost_usd is NULL for historical rows — backfilled by
-- scripts/backfill-cost.ts (todo:720e15fa) using current pricing.

-- ── queries: per-row cost + cache accounting ────────────────────────
ALTER TABLE queries
    ADD COLUMN IF NOT EXISTS cost_usd            NUMERIC(10, 6),
    ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER NOT NULL DEFAULT 0;

-- ── model_pricing: append-only price history ────────────────────────
-- Lookup pattern (computeCost):
--     SELECT … FROM model_pricing
--     WHERE model_id = $1
--       AND effective_from <= $2
--       AND (effective_to IS NULL OR effective_to > $2)
--     ORDER BY effective_from DESC LIMIT 1
--
-- Rows are NEVER mutated except to set effective_to on the previous
-- "current" row when a new one is inserted (handled by the sync
-- script, todo:8832ce67).
CREATE TABLE IF NOT EXISTS model_pricing (
    model_id                    TEXT          NOT NULL,
    input_price_per_mtok        NUMERIC(10, 4) NOT NULL,
    output_price_per_mtok       NUMERIC(10, 4) NOT NULL,
    cached_input_price_per_mtok NUMERIC(10, 4),                    -- NULL = model doesn't cache
    effective_from              TIMESTAMPTZ   NOT NULL,
    effective_to                TIMESTAMPTZ,                       -- NULL = currently active
    PRIMARY KEY (model_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_lookup
    ON model_pricing (model_id, effective_from DESC);

-- ── user_budgets: per-user, per-period usage + caps ─────────────────
-- query_limit / usd_limit are nullable: a NULL means "unenforced on
-- that axis". Free today: query_limit=10, usd_limit=NULL. Pro today:
-- query_limit=30, usd_limit=NULL. Future tiers can flip either or set
-- both, no schema change.
--
-- Period reset is lazy: when reserveBudget reads a row whose
-- reset_at <= now(), it zeros queries_used + usd_used and bumps
-- reset_at to the next period boundary. No cron needed.
CREATE TABLE IF NOT EXISTS user_budgets (
    user_id      TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period       TEXT          NOT NULL CHECK (period IN ('daily', 'monthly')),
    query_limit  INTEGER,
    usd_limit    NUMERIC(10, 4),
    queries_used INTEGER       NOT NULL DEFAULT 0,
    usd_used     NUMERIC(10, 6) NOT NULL DEFAULT 0,
    reset_at     TIMESTAMPTZ   NOT NULL,
    PRIMARY KEY (user_id, period)
);

-- ── backfill from quota_usage ───────────────────────────────────────
-- Carry today's per-user query count forward.  Limits are tier-aware
-- (10 for free, 30 for pro) so each user lands with the cap they'd
-- have under the current LIMITS const.  reset_at = next UTC midnight
-- (server is UTC per vps-bootstrap.sh:step_timezone).
--
-- Users who haven't queried today don't get a row here; reserveBudget
-- in src/lib/budget.ts (todo:e8e441a8) lazy-creates one on first
-- request.
INSERT INTO user_budgets (user_id, period, query_limit, queries_used, reset_at)
SELECT
    qu.user_id,
    'daily',
    CASE WHEN u.tier = 'pro' THEN 30 ELSE 10 END,
    qu.queries_used,
    (qu.date + INTERVAL '1 day')::timestamptz
FROM quota_usage qu
JOIN users u ON u.id = qu.user_id
WHERE qu.date = CURRENT_DATE
ON CONFLICT (user_id, period) DO NOTHING;

-- quota_usage stays in place — code switches over in todo:e8e441a8;
-- separate cleanup PR drops the table once user_budgets is canonical.
