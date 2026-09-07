-- 016_guest_queries.sql — anonymous "guest" queries in the queries table.
--
-- Spec: todo:1a766ce5 (parent feature: todo:ee3736aa).
--
-- The first-question funnel lets a visitor ask Guru one free question
-- before signing up. Rather than a parallel guest_queries table (which
-- would fork the schema and duplicate the row on conversion), a guest
-- question is stored as an ordinary queries row with user_id/session_id
-- NULL and tier_used = 'guest'. On signup the row is adopted in place —
-- UPDATE ... SET user_id, session_id — so the visitor's first question
-- literally becomes their first authenticated query. No copy, one table,
-- one source of truth for the admin spend/query views.
--
-- Consequences of a NULL user_id row (a not-yet-converted guest):
--   * Per-user / per-session rollups key on user_id / session_id and so
--     exclude guests automatically (GROUP BY user_id, JOIN sessions).
--   * Per-tier spend keys on tier_used IN ('pro','free'); 'guest' is
--     excluded by default, and admin adds an explicit guest bucket.
--   * The bare COUNT(*) FROM queries totals must decide include/exclude
--     guests explicitly (handled in admin-queries.ts, todo:85125f9e).
--
-- 002 made user_id/session_id NOT NULL back when every row came from a
-- live authenticated generation; 015 already relaxed model_used/tier_used
-- NOT NULL for forked rows. This relaxes the last two in the same spirit.
-- DROP NOT NULL and ADD COLUMN IF NOT EXISTS are no-ops on re-run.

ALTER TABLE queries
    ALTER COLUMN user_id    DROP NOT NULL,
    ALTER COLUMN session_id DROP NOT NULL;

-- Guest provenance. All NULL for authenticated rows.
--   guest_ip         — client IP at ask time; used for the admin label
--                      and shed (set NULL) on conversion, so a converted
--                      row carries no lingering PII.
--   ip_name          — stable pseudonym derived from the IP (lib/guest),
--                      the primary admin label so the raw IP isn't.
--   guest_token_hash — the signed-cookie entitlement id, the key the
--                      conversion UPDATE matches on.
ALTER TABLE queries ADD COLUMN IF NOT EXISTS guest_ip         TEXT;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS ip_name          TEXT;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS guest_token_hash TEXT;

-- Conversion lookup: adopt a guest's pending row by its token. Partial —
-- only unconverted guest rows are ever matched, and authed rows (the vast
-- majority) stay out of the index.
CREATE INDEX IF NOT EXISTS idx_queries_guest_token
    ON queries (guest_token_hash)
    WHERE user_id IS NULL AND guest_token_hash IS NOT NULL;

-- Guest list + retention purge: newest-first scan over pending guest rows.
CREATE INDEX IF NOT EXISTS idx_queries_guest_pending
    ON queries (created_at DESC)
    WHERE user_id IS NULL;
