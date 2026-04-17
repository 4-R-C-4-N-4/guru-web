-- 002_sessions_queries.sql

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS queries (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query_text      TEXT NOT NULL,
    response_text   TEXT NOT NULL,
    chunks_used     JSONB NOT NULL,
    model_used      TEXT NOT NULL,
    tier_used       TEXT NOT NULL,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queries_session ON queries(session_id, created_at);
