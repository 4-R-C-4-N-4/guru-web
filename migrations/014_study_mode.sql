-- 014_study_mode.sql — study-session mode + pinned text.
--
-- Spec: docs/summary-phase-w.md §W2. todo:efad9462 (parent: todo:55aa9982).
--
--   sessions.mode — 'chat' (default, existing behaviour) or 'study'
--     (dossier block + summary retrieval leg, pinned to one text).
--     CHECK here because the value set is closed and app-independent.
--   sessions.study_text_id — the pinned corpus text. TEXT with no FK:
--     the corpus lives in a separate schema that is dropped and swapped
--     wholesale on corpus deploys, so a cross-schema FK would break the
--     swap. Existence is validated in the API layer at create time
--     instead (mode='study' requires a study_text_id that resolves in
--     corpus.texts).
--
-- ADD COLUMN IF NOT EXISTS keeps re-runs no-ops, matching deploy.sh
-- (psql -1 -v ON_ERROR_STOP=1).

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'chat'
        CHECK (mode IN ('chat', 'study'));

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS study_text_id TEXT;
