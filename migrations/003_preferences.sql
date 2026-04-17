-- 003_preferences.sql

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    scope_mode             TEXT NOT NULL DEFAULT 'all',   -- all | whitelist | blacklist
    blocked_traditions     TEXT[] DEFAULT '{}',
    blocked_texts          TEXT[] DEFAULT '{}',
    whitelisted_traditions TEXT[] DEFAULT '{}',
    whitelisted_texts      TEXT[] DEFAULT '{}',
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
