-- 012_chat_voice.sql — chat voice picker schema.
--
-- Spec: docs/chat-voice/BRD-chat-voice.md §7.1, IMPL §4.
-- todo:1a6e4137 (parent feature: todo:e8417da2).
--
-- Two columns, two distinct jobs:
--   user_preferences.preferred_voice — the user's *default* for new
--     sessions. Mutable from the settings page. NOT NULL DEFAULT
--     'scholar' so existing pro users transparently land on the
--     current production voice.
--   sessions.voice — an *immutable snapshot* of the voice the session
--     was created under. The query route reads this column at every
--     turn so a profile-voice change never re-skins a thread already
--     in flight. NOT NULL DEFAULT 'scholar' so sessions inserted
--     before ticket 5's snapshot logic ships still get the live
--     production voice without code changes.
--
-- No CHECK constraint on either column — validated in app code via
-- isVoiceSlug() at write boundaries (mirrors the preferred_model
-- pattern from migration 009).
--
-- Both ADD COLUMNs use IF NOT EXISTS so re-running the migration is
-- a no-op, matching the operator's deploy.sh contract
-- (psql -1 -v ON_ERROR_STOP=1).

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS preferred_voice TEXT NOT NULL DEFAULT 'scholar';

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS voice TEXT NOT NULL DEFAULT 'scholar';
