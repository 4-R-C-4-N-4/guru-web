-- 001_users.sql
-- App-managed users table. id = Clerk user ID.

CREATE TABLE IF NOT EXISTS users (
    id                 TEXT PRIMARY KEY,       -- Clerk user ID
    email              TEXT UNIQUE NOT NULL,
    tier               TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
