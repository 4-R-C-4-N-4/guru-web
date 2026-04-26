-- 005_rate_limits.sql
--
-- Per-user min-interval limiter used by /api/query (1s) and /api/checkout (5min).
-- One row per (user_id, scope); claim/refresh atomically via UPSERT.

CREATE TABLE IF NOT EXISTS rate_limits (
    user_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope    TEXT        NOT NULL,
    last_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, scope)
);
