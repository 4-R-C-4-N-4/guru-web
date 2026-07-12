-- 015_session_shares.sql — public share links for chat sessions.
--
-- Spec: todo:5f35c4a7 (parent feature: todo:36421ff5).
--
-- A share is an *immutable snapshot* of a session at share time, not a
-- live view: the owner continuing the chat privately must not leak new
-- turns, and the share must keep rendering after corpus re-imports and
-- even after the source session is deleted. So everything the public
-- page needs is denormalized onto this row.
--
--   slug — the public identifier in /share/[slug]. Random, generated
--     app-side; deliberately NOT the session uuid, so revoking and
--     re-sharing mints a fresh URL and the real session id never
--     leaves the authed API surface. UNIQUE doubles as the lookup
--     index.
--   session_id — provenance + "one active share per session" lookups.
--     ON DELETE SET NULL (column therefore nullable): deleting the
--     session cascades its queries away, but the share row is
--     self-contained and survives.
--   user_id — the share's owner (Clerk user id, as everywhere).
--     CASCADE: a hard-deleted user takes their shares with them.
--   messages — ordered turns incl. rich citation objects
--     ({id,tradition,text_name,section,tier}), same shape as
--     blog_posts.chunks_used (013). Snapshotted so the public page
--     never JOINs corpus.chunks — bare chunk ids in queries.chunks_used
--     go stale when the corpus schema is dropped and swapped on deploy.
--   voice / mode / study_text_id / retrieval_scope — the session
--     settings a fork needs to reproduce the conversation faithfully:
--     voice+mode+study_text_id copied from sessions, retrieval_scope a
--     snapshot of the owner's user_preferences scope fields (scopeMode,
--     blocked/whitelisted traditions/texts) taken at share time. No
--     CHECK on mode here: sessions (014) already enforces the value
--     set at the source; duplicating it would force lockstep ALTERs
--     when a mode is added.
--   revoked_at — soft revoke. The public read helper filters
--     revoked_at IS NULL; the row stays for provenance
--     (sessions.forked_from_share_id points here).
--
-- IF NOT EXISTS throughout keeps re-runs no-ops, matching deploy.sh
-- (psql -1 -v ON_ERROR_STOP=1).

CREATE TABLE IF NOT EXISTS session_shares (
    id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    slug            TEXT        UNIQUE NOT NULL,
    session_id      TEXT        REFERENCES sessions(id) ON DELETE SET NULL,
    user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    messages        JSONB       NOT NULL,
    voice           TEXT        NOT NULL,
    mode            TEXT        NOT NULL,
    study_text_id   TEXT,
    retrieval_scope JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);

-- "Does this session already have an active share?" — the share API's
-- idempotency check and the chat header's share-state fetch.
CREATE INDEX IF NOT EXISTS idx_session_shares_session
    ON session_shares (session_id)
    WHERE revoked_at IS NULL;

-- Fork-side columns on sessions:
--   scope_override — retrieval scope frozen onto a *forked* session
--     (copied from session_shares.retrieval_scope at fork time). NULL
--     everywhere else = query route keeps reading live user prefs, so
--     existing sessions are untouched. Mirrors the sessions.voice
--     snapshot doctrine (012).
--   forked_from_share_id — provenance only, no FK: forks must outlive
--     any future hard-delete of share rows, and analytics just needs
--     the id to exclude forked rows from cost aggregates.

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS scope_override JSONB;

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS forked_from_share_id TEXT;
