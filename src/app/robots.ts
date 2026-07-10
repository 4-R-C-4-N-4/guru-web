/**
 * src/app/robots.ts
 *
 * Next metadata route serving /robots.txt (todo:64521773). Before this the
 * origin served nothing — Cloudflare's Content Signals feature injected a
 * comment-only robots.txt with no directives and no Sitemap line, so Google
 * had no sitemap pointer at all. Cloudflare prepends its content-signal
 * block to an origin robots.txt, so both coexist once this deploys.
 *
 * Disallowed paths are the authed app surface (they redirect to sign-in for
 * anonymous crawlers anyway) plus /api and /admin. The public content
 * surface — /, /blog, /blog/[slug], /atlas — stays crawlable.
 */
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/sign-in',
          '/sign-up',
          '/chat',
          '/history',
          '/settings',
          '/account',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
