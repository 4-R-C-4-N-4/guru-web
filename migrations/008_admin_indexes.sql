-- 008_admin_indexes.sql — indexes for the admin observability layer.
--
-- Spec: docs/admin-ui/BRD-admin-ui.md §1.11. todo:a0506db7.
--
-- The admin views aggregate over queries and sessions in shapes the
-- live app didn't need:
--
--   - Users list:    MAX(queries.created_at) GROUP BY user_id
--                    SUM(queries.cost_usd)   GROUP BY user_id
--                    → idx_queries_user_created.
--
--   - Overview tiles + sparklines: filter / aggregate queries by
--     created_at across all users.
--                    → idx_queries_created.
--
--   - All-sessions list (admin):  ORDER BY sessions.updated_at DESC.
--     The existing idx_sessions_user(user_id, updated_at DESC) is
--     useless for cross-user listings — it only covers per-user.
--                    → idx_sessions_updated.
--
-- All idempotent (`IF NOT EXISTS`); re-running the migration is the
-- test. cost_usd does not need its own index — it ride-alongs the
-- two queries indexes since admin spend rollups are time-bucketed.

CREATE INDEX IF NOT EXISTS idx_queries_user_created
    ON queries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_queries_created
    ON queries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_updated
    ON sessions (updated_at DESC);
