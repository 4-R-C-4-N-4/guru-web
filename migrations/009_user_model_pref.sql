-- 009_user_model_pref.sql — user-pickable model preference (pro tier).
--
-- Spec: docs/model-selection/BRD-model-selection.md §6.1.
-- todo:9a0dedf3 (parent feature: todo:6e4e89c5).
--
-- Single nullable column on user_preferences. NULL means "use the
-- tier default" (resolved at request time from CURATED_MODELS in
-- src/lib/model.ts). Free users may save a value; it's ignored at
-- query time per BRD §7.2 — free is always pinned to the tier
-- default.
--
-- The value is a CURATED_MODELS slug (e.g. 'anthropic'), not an
-- OpenRouter model ID. The slug indirection is what lets us bump
-- versions silently — see BRD §5.1.

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS preferred_model TEXT;
