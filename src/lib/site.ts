/**
 * src/lib/site.ts
 *
 * Canonical public origin for absolute-URL generation (sitemap, robots,
 * metadataBase). Reads NEXT_PUBLIC_APP_URL (required by boot.ts in prod);
 * the literal fallback exists only for build-time/test contexts where the
 * env file isn't loaded — crawl surfaces must always emit the production
 * origin, never localhost or the tailnet host.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://guru-ai.org').replace(/\/$/, '');
