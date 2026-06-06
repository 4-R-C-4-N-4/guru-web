/**
 * src/lib/admin-blog.ts
 *
 * SQL helpers for the grounded blog pipeline admin surface (IMPL T4).
 * Mirrors admin-queries.ts: keeps route handlers thin and groups the SQL
 * where it can be reviewed as a unit.
 *
 * Unlike admin-queries.ts these are NOT all read-only — the blog routes are
 * the first mutating /api/admin/* endpoints (insertSeed / setStatus). They
 * still gate on requireAdmin() at the route layer.
 *
 * Spec: docs/blog-pipeline/BRD-blog-pipeline.md §5.4, IMPL T4.
 */

import { one, query } from './db';

// ── Types ────────────────────────────────────────────────────────────

/** A blog_posts row as the admin views read it. */
export interface BlogPostRow {
  id: string;
  status: string;
  seed_kind: string;
  topic: string | null;
  concept_ids: string[] | null;
  edge_ref: string | null;
  angle: string | null;
  model: string;
  scope_mode: string;
  blocked_traditions: string[] | null;
  blocked_texts: string[] | null;
  whitelisted_traditions: string[] | null;
  whitelisted_texts: string[] | null;
  priority: number | null;
  created_by: string | null;
  title: string | null;
  slug: string | null;
  dek: string | null;
  content: string | null;
  chunks_used: unknown;
  cost_usd: string | null;
  error_note: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

/**
 * The fields the seed form supplies when queueing a custom seed. Exactly one
 * of `topic` (free-text mode) or `concept_ids` (concept-pair mode) is
 * populated; the seed route enforces the XOR.
 */
export interface SeedInput {
  topic: string | null;
  concept_ids: string[] | null;
  angle: string | null;
  model: string;
  scope_mode: string;
  blocked_traditions: string[];
  blocked_texts: string[];
  whitelisted_traditions: string[];
  whitelisted_texts: string[];
  created_by: string | null;
}

const POST_COLUMNS = `id, status, seed_kind, topic, concept_ids, edge_ref, angle, model,
  scope_mode, blocked_traditions, blocked_texts,
  whitelisted_traditions, whitelisted_texts,
  priority, created_by, title, slug, dek, content, chunks_used,
  cost_usd, error_note, created_at, updated_at, published_at`;

// ── Reads ────────────────────────────────────────────────────────────

/**
 * Posts in a given status, newest first — drives the Queue / Drafts /
 * Published tabs. Covered by idx_blog_posts_status.
 */
export async function listPosts(status: string): Promise<BlogPostRow[]> {
  return query<BlogPostRow>(
    `SELECT ${POST_COLUMNS} FROM blog_posts WHERE status = $1 ORDER BY created_at DESC`,
    [status],
  );
}

/** A single post by id, or null. */
export async function getPost(id: string): Promise<BlogPostRow | null> {
  return one<BlogPostRow>(
    `SELECT ${POST_COLUMNS} FROM blog_posts WHERE id = $1`,
    [id],
  );
}

/**
 * Tradition → texts catalog for the seed form, computed server-side. Same
 * shape and query as /api/corpus, but callable from admin context where the
 * requireUser-gated /api/corpus is unreachable. Empty result is meaningful
 * (corpus not restored) — the caller must surface it, never substitute a
 * fallback.
 */
export async function listCorpusCatalog(): Promise<Record<string, { texts: string[] }>> {
  const rows = await query<{ tradition: string; text_name: string }>(
    `SELECT DISTINCT tradition, text_name
       FROM chunks
       WHERE tradition IS NOT NULL AND text_name IS NOT NULL
       ORDER BY tradition, text_name`,
  );
  const traditions: Record<string, { texts: string[] }> = {};
  for (const { tradition, text_name } of rows) {
    if (!traditions[tradition]) traditions[tradition] = { texts: [] };
    traditions[tradition].texts.push(text_name);
  }
  return traditions;
}

// ── Writes ───────────────────────────────────────────────────────────

/**
 * Insert a queued, operator-authored ('custom') seed and return its row.
 * seed_kind is always 'custom' this phase — the corpus-derived 'candidate'
 * path is deferred (IMPL Open Questions §1).
 */
export async function insertSeed(seed: SeedInput): Promise<BlogPostRow> {
  const row = await one<BlogPostRow>(
    `INSERT INTO blog_posts
       (status, seed_kind, topic, concept_ids, angle, model, scope_mode,
        blocked_traditions, blocked_texts,
        whitelisted_traditions, whitelisted_texts, created_by)
     VALUES ('queued', 'custom', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${POST_COLUMNS}`,
    [
      seed.topic,
      seed.concept_ids,
      seed.angle,
      seed.model,
      seed.scope_mode,
      seed.blocked_traditions,
      seed.blocked_texts,
      seed.whitelisted_traditions,
      seed.whitelisted_texts,
      seed.created_by,
    ],
  );
  // one() can only be null if RETURNING produced no row, which an INSERT
  // never does on success — assert for the type, fail loud if violated.
  if (!row) throw new Error('insertSeed: INSERT returned no row');
  return row;
}

/** Outcome of a guarded status transition (see setStatus). */
export type SetStatusResult =
  | { ok: true; row: BlogPostRow }
  | { ok: false; reason: 'not_found' | 'illegal_transition' };

/**
 * Transition a post's status. When moving to 'published', stamps published_at.
 *
 * Publishing is guarded: it only applies to a generated `draft` with non-null
 * content. Without this, a direct POST could publish a `queued`/`needs_attention`
 * row (whose content is NULL — migration 013 has no NOT NULL/CHECK), which would
 * make dekFromContent() throw and 500 the public /blog index and homepage feed
 * (both call listPublished). reject/archive are unguarded — they only ever move
 * a post OUT of public view, so they can't create a broken live post.
 *
 * The guarded UPDATE is atomic (no check-then-act race); a 0-row result means
 * either the id is unknown or the transition was illegal, disambiguated with a
 * follow-up read on the (rare) failure path only.
 */
export async function setStatus(
  id: string,
  status: 'published' | 'rejected' | 'archived',
): Promise<SetStatusResult> {
  const publishedAt = status === 'published' ? 'now()' : 'published_at';
  const guard = status === 'published' ? "AND status = 'draft' AND content IS NOT NULL" : '';
  const row = await one<BlogPostRow>(
    `UPDATE blog_posts
        SET status = $2, published_at = ${publishedAt}, updated_at = now()
      WHERE id = $1 ${guard}
      RETURNING ${POST_COLUMNS}`,
    [id, status],
  );
  if (row) return { ok: true, row };
  // 0 rows: unknown id, or a publish blocked by the guard.
  const exists = await getPost(id);
  return { ok: false, reason: exists ? 'illegal_transition' : 'not_found' };
}

/** Outcome of a manual draft edit. */
export type EditDraftResult =
  | { ok: true; row: BlogPostRow }
  | { ok: false; reason: 'not_found' | 'not_editable' | 'empty' };

/**
 * Manually edit a draft's title/dek/content before publishing — the operator's
 * scalpel on LLM output. Editable only while a row is `draft` or
 * `needs_attention` (never a published/rejected/archived post). title and
 * content must be non-empty; editing a `needs_attention` row with content
 * promotes it to `draft` and clears its error_note, so a parked seed can be
 * salvaged by hand. The guarded UPDATE is atomic (no check-then-act race).
 */
export async function updateDraft(
  id: string,
  fields: { title: string; dek: string | null; content: string },
): Promise<EditDraftResult> {
  const title = fields.title.trim();
  const content = fields.content;
  if (!title || !content.trim()) return { ok: false, reason: 'empty' };

  const row = await one<BlogPostRow>(
    `UPDATE blog_posts
        SET title = $2, dek = $3, content = $4,
            status = 'draft', error_note = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('draft', 'needs_attention')
      RETURNING ${POST_COLUMNS}`,
    [id, title, fields.dek?.trim() || null, content],
  );
  if (row) return { ok: true, row };
  const exists = await getPost(id);
  return { ok: false, reason: exists ? 'not_editable' : 'not_found' };
}
