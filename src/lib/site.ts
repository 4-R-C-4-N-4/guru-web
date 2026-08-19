/**
 * src/lib/site.ts
 *
 * Canonical public origin for absolute-URL generation (sitemap, robots,
 * metadataBase). Reads NEXT_PUBLIC_APP_URL (required by boot.ts in prod);
 * the literal fallback exists only for build-time/test contexts where the
 * env file isn't loaded — crawl surfaces must always emit the production
 * origin, never localhost or the tailnet host.
 */
import type { Metadata } from 'next';

export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://guru-ai.org').replace(/\/$/, '');

/**
 * Default social-card image (todo:7cf30162). Static asset in public/, resolved
 * absolute against metadataBase (SITE_URL). Shared so pages that override
 * openGraph — which shallow-REPLACES the root openGraph in Next, dropping its
 * images — can re-attach the same image instead of rendering a blank card.
 * The width/height let crawlers reserve layout before the fetch completes.
 */
export const OG_IMAGE = {
  url: '/og.png',
  width: 1200,
  height: 630,
  alt: 'Guru — Cross-Tradition Esoteric Research',
} as const;

const SITE_TAGLINE = 'Guru — Cross-Tradition Esoteric Research';
const SITE_DESCRIPTION =
  'Discover the hidden threads between Gnostic aeons, Kabbalistic sefirot, Neoplatonic emanations, and Vedantic consciousness — traced to their sources, every claim cited.';

/**
 * Sitewide social-card defaults (todo:7cf30162), spread into the root
 * metadata. openGraph covers every route that doesn't override it; twitter is
 * overridden by no page, so it cascades to all routes — and since X reads
 * twitter:image preferentially, even openGraph-overriding pages get a card.
 * twitter intentionally omits title/description so per-page og:title /
 * og:description populate the card instead of these static defaults.
 */
export const SOCIAL_METADATA = {
  openGraph: {
    type: 'website',
    siteName: 'Guru',
    title: SITE_TAGLINE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    images: [OG_IMAGE.url],
  },
} satisfies Pick<Metadata, 'openGraph' | 'twitter'>;
