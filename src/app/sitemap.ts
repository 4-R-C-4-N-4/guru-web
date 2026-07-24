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
import { listSitemapCorpusCached } from '@/lib/reader';
import { chunkIdToPath } from '@/lib/read-path';
import { SITE_URL } from '@/lib/site';

// Without this, Next prerenders sitemap.xml at build time (metadata routes
// are cached by default) — the post list would freeze at deploy and the
// build would need a live DB. Same convention as /, /blog, /atlas.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Reader URLs: every tradition, text TOC and chunk page (~4.6k URLs,
  // well under the 50k sitemap cap). Both reads are cached (60s posts,
  // 3600s corpus scans) so crawler fetches don't add query load.
  const [posts, { texts: textRows, chunks, concepts }] = await Promise.all([
    listPublishedCached(),
    listSitemapCorpusCached(),
  ]);
  const traditions = [...new Set(textRows.map(t => t.tradition))];

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/atlas`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/read`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/read/concepts`, changeFrequency: 'monthly', priority: 0.6 },
  ];

  return [
    ...staticPages,
    ...posts.map((p) => ({
      url: `${SITE_URL}/blog/${p.slug}`,
      lastModified: new Date(p.published_at),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    ...traditions.map(t => ({
      url: `${SITE_URL}/read/${t}`,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
    ...textRows.map(t => ({
      url: `${SITE_URL}/read/${t.tradition}/${t.id}`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...concepts.map(c => ({
      url: `${SITE_URL}/read/concepts/${c.id.replace(/^concept\./, '')}`,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
    ...chunks.flatMap(c => {
      const path = chunkIdToPath(c.id);
      return path ? [{
        url: `${SITE_URL}${path}`,
        changeFrequency: 'yearly' as const,
        priority: 0.4,
      }] : [];
    }),
  ];
}
