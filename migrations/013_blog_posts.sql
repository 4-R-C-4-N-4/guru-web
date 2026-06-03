-- 013_blog_posts.sql — grounded blog pipeline (manual phase) schema.
--
-- Spec: docs/blog-pipeline/BRD-blog-pipeline.md §5.1, IMPL §T1.
-- todo:64be313c (parent feature: todo:467f527c).
--
-- One table drives the whole editorial lifecycle. A row starts as a
-- queued *seed* (a cross-tradition concept pair the operator wants an
-- essay about), is turned into a draft by generateDraft(), and is then
-- published / rejected / archived through the admin surface. Status is a
-- plain TEXT lifecycle column:
--   queued → generating → draft → published
--                       ↘ needs_attention   (thin retrieval / error)
--                       ↘ rejected / archived
--
-- Column notes:
--   seed_kind — 'custom' for operator-authored pairs (the only kind this
--     phase). 'candidate' is reserved for the deferred corpus-derived
--     auto-proposal path (IMPL Open Questions §1; gated on edges.weight,
--     todo:9f401f76). Kept in the schema now so that path returns without
--     a migration.
--   edge_ref — reserved companion to seed_kind: "<source>|<target>|<edge_type>"
--     for a candidate's originating PARALLELS edge. NULL for custom seeds.
--   topic / concept_ids — the two seeding modes. A 'topic' seed carries a
--     free-text prompt the operator wants an essay on (the general path); a
--     concept-pair seed carries exactly two concept IDs (the cross-tradition
--     parallel path). Exactly one is populated per row; both are nullable at
--     the DB level and the XOR is enforced in app code (the seed route).
--   created_by — operator email, NOT a FK to users. Admin runs behind the
--     tailnet Caddy listener and requireAdmin() returns a synthetic
--     operator (src/lib/admin.ts) with no users row.
--   chunks_used — richer than queries.chunks_used (which stores bare IDs):
--     a JSONB array of {id, tradition, text_name, section, tier} so the
--     public Sources block and draft grounding-review render without a
--     corpus join and survive a corpus re-import.
--   voice — reserved; one internal blog voice this phase (no picker).
--
-- No CHECK constraints — status / seed_kind / model / scope_mode are all
-- validated in app code at the write boundaries (mirrors the
-- preferred_voice / preferred_model precedent in migrations 009 and 012).
--
-- CREATE TABLE / CREATE INDEX all use IF NOT EXISTS so re-running the
-- migration is a no-op, matching the operator's deploy.sh contract
-- (psql -1 -v ON_ERROR_STOP=1). gen_random_uuid() is already relied on by
-- sessions / queries (migration 002), so no extension step is needed.

CREATE TABLE IF NOT EXISTS blog_posts (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    status        TEXT NOT NULL DEFAULT 'queued',
    seed_kind     TEXT NOT NULL,            -- 'candidate' | 'custom'
    topic         TEXT,                      -- free-text prompt seed (mode A); NULL for concept-pair seeds
    concept_ids   TEXT[],                    -- exactly two for a concept-pair seed (mode B); NULL for topic seeds
    edge_ref      TEXT,                      -- "<source>|<target>|<edge_type>"
    angle         TEXT,
    voice         TEXT,                      -- reserved; one blog voice in this phase
    model         TEXT NOT NULL DEFAULT 'deepseek',

    scope_mode             TEXT NOT NULL DEFAULT 'all',
    blocked_traditions     TEXT[],
    blocked_texts          TEXT[],
    whitelisted_traditions TEXT[],
    whitelisted_texts      TEXT[],

    priority      INTEGER,
    created_by    TEXT,                      -- operator email; no FK (synthetic tailnet operator)

    title         TEXT,
    slug          TEXT UNIQUE,
    dek           TEXT,                      -- model-authored framing sentence (the DEK: head); NULL for legacy rows, where the public reader falls back to the first sentence of content
    content       TEXT,
    chunks_used   JSONB,
    cost_usd      NUMERIC(10, 6),
    error_note    TEXT,

    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    published_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status
    ON blog_posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published
    ON blog_posts(published_at DESC) WHERE status = 'published';

-- Dual-mode seeding upgrade (todo:bf1c07fb). The CREATE TABLE above is a no-op
-- on a table that already exists from an earlier version of this migration, so
-- these idempotent ALTERs carry the free-text `topic` column and the relaxed
-- concept_ids constraint to an existing install. Both are no-ops on a fresh
-- build (the CREATE TABLE already matches). 013 is still unmerged, so editing
-- it in place is the contract here.
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE blog_posts ALTER COLUMN concept_ids DROP NOT NULL;
-- Persist the model-authored DEK (todo:d48b44ba). Previously parseGenerated
-- computed a dek and the call site discarded it, so the public surface
-- re-derived a worse one from the essay's first sentence. Nullable: legacy rows
-- generated before this column stay NULL and fall back to the first-sentence dek.
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS dek TEXT;
