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

import { one, query, exec } from './db';

// ── Types ────────────────────────────────────────────────────────────

/** A blog_posts row as the admin views read it. */
export interface BlogPostRow {
  id: string;
  status: string;
  seed_kind: string;
  concept_ids: string[];
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
  content: string | null;
  chunks_used: unknown;
  cost_usd: string | null;
  error_note: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

/** The fields the seed form supplies when queueing a custom seed. */
export interface SeedInput {
  concept_ids: string[];
  angle: string | null;
  model: string;
  scope_mode: string;
  blocked_traditions: string[];
  blocked_texts: string[];
  whitelisted_traditions: string[];
  whitelisted_texts: string[];
  created_by: string | null;
}

const POST_COLUMNS = `id, status, seed_kind, concept_ids, edge_ref, angle, model,
  scope_mode, blocked_traditions, blocked_texts,
  whitelisted_traditions, whitelisted_texts,
  priority, created_by, title, slug, content, chunks_used,
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
       (status, seed_kind, concept_ids, angle, model, scope_mode,
        blocked_traditions, blocked_texts,
        whitelisted_traditions, whitelisted_texts, created_by)
     VALUES ('queued', 'custom', $1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${POST_COLUMNS}`,
    [
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

/**
 * Transition a post's status. When moving to 'published', stamps
 * published_at; otherwise leaves it untouched. Returns the updated row
 * (null if the id doesn't exist).
 */
export async function setStatus(
  id: string,
  status: 'published' | 'rejected' | 'archived',
): Promise<BlogPostRow | null> {
  const publishedAt = status === 'published' ? 'now()' : 'published_at';
  await exec(
    `UPDATE blog_posts
        SET status = $2, published_at = ${publishedAt}, updated_at = now()
      WHERE id = $1`,
    [id, status],
  );
  return getPost(id);
}
