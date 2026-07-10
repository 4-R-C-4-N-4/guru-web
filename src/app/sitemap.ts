/**
 * src/app/sitemap.ts
 *
 * Next metadata route serving /sitemap.xml (todo:64521773) — previously this
 * URL 404'd, which is one reason Google never indexed the site. Lists the
 * static public pages plus every published essay (listPublishedCached returns
 * all published blog_posts rows, atlas editions included, and they all render
 * at /blog/[slug]).
 *
 * The DB read is the same 60s-cached query the /blog index uses, so crawler
 * fetches don't add query load. If the DB is down the route 500s — that's
 * deliberate (no silent fallback to a stale static list); Googlebot retries.
 */
import type { MetadataRoute } from 'next';
import { listPublishedCached } from '@/lib/blog-public';
import { SITE_URL } from '@/lib/site';

// Without this, Next prerenders sitemap.xml at build time (metadata routes
// are cached by default) — the post list would freeze at deploy and the
// build would need a live DB. Same convention as /, /blog, /atlas.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await listPublishedCached();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/atlas`, changeFrequency: 'monthly', priority: 0.6 },
  ];

  return [
    ...staticPages,
    ...posts.map((p) => ({
      url: `${SITE_URL}/blog/${p.slug}`,
      lastModified: new Date(p.published_at),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
