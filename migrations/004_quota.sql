-- 004_quota.sql

CREATE TABLE IF NOT EXISTS quota_usage (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         DATE NOT NULL,
    queries_used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);
