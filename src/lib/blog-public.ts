/**
 * src/lib/blog-public.ts
 *
 * Read helpers for the PUBLIC blog surface (IMPL T8). These power the
 * unauthenticated /blog index and /blog/[slug] post pages, so they only
 * ever return `published` rows — a draft / needs_attention / archived post
 * must never leak to the public.
 *
 * Spec: docs/blog-pipeline/BRD-blog-pipeline.md §5.6, IMPL T8.
 */

import { one, query } from './db';

/** A stored source entry on a published post (the chunks_used JSONB shape). */
export interface PublishedSource {
  id: string;
  tradition: string;
  text_name: string;
  section: string;
  tier: 'verified' | 'proposed' | 'inferred';
}

/** A published post as the public pages read it. */
export interface PublishedPost {
  id: string;
  title: string;
  slug: string;
  dek: string | null;
  content: string;
  chunks_used: PublishedSource[];
  published_at: string;
}

/** A row in the /blog index — just enough to render a card. */
export interface PublishedListItem {
  title: string;
  slug: string;
  dek: string | null;
  published_at: string;
}

/**
 * Derive the dek (one-sentence framing) from the first line of content.
 * The generator strips the TITLE:/DEK: head before storing, so the dek is
 * not a column — we surface the post's opening sentence as the card blurb.
 */
function dekFromContent(content: string): string | null {
  const firstPara = content.split(/\n\s*\n/)[0]?.trim() ?? '';
  if (!firstPara) return null;
  const sentence = firstPara.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? firstPara;
  return sentence.slice(0, 200) || null;
}

/** Published posts, newest first (covered by idx_blog_posts_published). */
export async function listPublished(): Promise<PublishedListItem[]> {
  const rows = await query<{ title: string; slug: string; content: string; published_at: string }>(
    `SELECT title, slug, content, published_at
       FROM blog_posts
      WHERE status = 'published'
      ORDER BY published_at DESC`,
  );
  return rows.map(r => ({
    title: r.title,
    slug: r.slug,
    dek: dekFromContent(r.content),
    published_at: r.published_at,
  }));
}

/**
 * A single published post by slug, or null if the slug is unknown OR the
 * post is not published (draft/archived slugs 404 on the public side).
 */
export async function getPublishedBySlug(slug: string): Promise<PublishedPost | null> {
  const row = await one<{
    id: string;
    title: string;
    slug: string;
    content: string;
    chunks_used: PublishedSource[] | null;
    published_at: string;
  }>(
    `SELECT id, title, slug, content, chunks_used, published_at
       FROM blog_posts
      WHERE slug = $1 AND status = 'published'`,
    [slug],
  );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    dek: dekFromContent(row.content),
    content: row.content,
    chunks_used: Array.isArray(row.chunks_used) ? row.chunks_used : [],
    published_at: row.published_at,
  };
}
