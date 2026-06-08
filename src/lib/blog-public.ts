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

import { unstable_cache } from 'next/cache';
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
 * Legacy fallback for the dek (one-sentence framing). New drafts persist the
 * model-authored DEK in the `dek` column (todo:d48b44ba); rows generated before
 * that column existed have dek=NULL, so for those we surface the post's opening
 * sentence as the card blurb. Prefer the stored dek whenever present.
 */
function dekFromContent(content: string | null): string | null {
  // Null-safe: a published row should always have content, but never let one
  // malformed row throw and 500 the whole list path (defense-in-depth with the
  // publish guard in admin-blog.setStatus).
  if (!content) return null;
  const firstPara = content.split(/\n\s*\n/)[0]?.trim() ?? '';
  if (!firstPara) return null;
  const sentence = firstPara.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? firstPara;
  return sentence.slice(0, 200) || null;
}

/**
 * Published posts, newest first (covered by idx_blog_posts_published). Pass a
 * `limit` to cap the result — used by the homepage "Latest Essays" feed; the
 * /blog index calls it with no limit to list everything.
 */
export async function listPublished(limit?: number): Promise<PublishedListItem[]> {
  // Only ever read enough of `content` to derive a legacy dek — never the full
  // multi-KB essay body, which the cards don't render (the post page reads full
  // content via getPublishedBySlug). New rows use the stored `dek` and ignore
  // dek_source entirely.
  const rows = await query<{ title: string; slug: string; dek: string | null; dek_source: string | null; published_at: string }>(
    `SELECT title, slug, dek, left(content, 300) AS dek_source, published_at
       FROM blog_posts
      WHERE status = 'published' AND slug IS NOT NULL AND content IS NOT NULL
      ORDER BY published_at DESC${limit !== undefined ? ' LIMIT $1' : ''}`,
    limit !== undefined ? [limit] : undefined,
  );
  return rows.map(r => ({
    title: r.title,
    slug: r.slug,
    dek: r.dek ?? dekFromContent(r.dek_source),
    published_at: r.published_at,
  }));
}

/**
 * Cached listPublished for the public pages (homepage feed + /blog index). This
 * is the bot shield: between publishes every anonymous request returns identical
 * output, so one query is shared across the revalidate window instead of running
 * per request. unstable_cache keys on the limit argument, so listPublishedCached(3)
 * and listPublishedCached() cache independently.
 *
 * Invalidation is TTL-based: a 60s revalidate means a newly published or archived
 * post appears within a minute — fine for the manual editorial cadence, and it
 * keeps the cache decoupled from Next 16's evolving on-demand revalidate API. The
 * `published-posts` tag is set so on-demand busting can be wired in later.
 */
export const listPublishedCached = unstable_cache(
  (limit?: number) => listPublished(limit),
  ['blog-public:listPublished'],
  { revalidate: 60, tags: ['published-posts'] },
);

/** A published "State of the Atlas" edition as the /atlas almanac index reads it. */
export interface AtlasEditionListItem extends PublishedListItem {
  edition_no: number | null;
}

/**
 * Published atlas editions, newest edition first — drives the /atlas almanac
 * index. Same published/slug/content guards and dek fallback as listPublished,
 * filtered to seed_kind='atlas'.
 */
export async function listAtlasEditions(): Promise<AtlasEditionListItem[]> {
  const rows = await query<{ title: string; slug: string; dek: string | null; dek_source: string | null; published_at: string; edition_no: number | null }>(
    `SELECT title, slug, dek, left(content, 300) AS dek_source, published_at, edition_no
       FROM blog_posts
      WHERE status = 'published' AND seed_kind = 'atlas' AND slug IS NOT NULL AND content IS NOT NULL
      ORDER BY edition_no DESC NULLS LAST, published_at DESC`,
  );
  return rows.map(r => ({
    title: r.title,
    slug: r.slug,
    dek: r.dek ?? dekFromContent(r.dek_source),
    published_at: r.published_at,
    edition_no: r.edition_no,
  }));
}

export const listAtlasEditionsCached = unstable_cache(
  () => listAtlasEditions(),
  ['blog-public:listAtlasEditions'],
  { revalidate: 60, tags: ['published-posts'] },
);

/**
 * A single published post by slug, or null if the slug is unknown OR the
 * post is not published (draft/archived slugs 404 on the public side).
 */
export async function getPublishedBySlug(slug: string): Promise<PublishedPost | null> {
  const row = await one<{
    id: string;
    title: string;
    slug: string;
    dek: string | null;
    content: string;
    chunks_used: PublishedSource[] | null;
    published_at: string;
  }>(
    `SELECT id, title, slug, dek, content, chunks_used, published_at
       FROM blog_posts
      WHERE slug = $1 AND status = 'published' AND content IS NOT NULL`,
    [slug],
  );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    dek: row.dek ?? dekFromContent(row.content),
    content: row.content,
    chunks_used: Array.isArray(row.chunks_used) ? row.chunks_used : [],
    published_at: row.published_at,
  };
}
