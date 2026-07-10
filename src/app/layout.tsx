import type { Metadata } from 'next';
import { Cormorant_Garamond, IBM_Plex_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { headers } from 'next/headers';
import { clerkAppearance } from '@/styles/clerk-appearance';
import { tokensToCssVars } from '@/styles/tokens';
import { TAILNET_HOST } from '@/lib/host';
import { SITE_URL } from '@/lib/site';
import './globals.css';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // metadataBase makes per-page canonical/OG URLs resolve absolute against
  // the production origin instead of the request host (which would leak the
  // tailnet hostname into crawlable markup on admin requests).
  metadataBase: new URL(SITE_URL),
  title: 'Guru — Cross-Tradition Esoteric Research',
  description:
    'Discover the hidden threads between Gnostic aeons, Kabbalistic sefirot, Neoplatonic emanations, and Vedantic consciousness — traced to their sources, every claim cited.',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // ClerkProvider in @clerk/nextjs 7.x + Next 16 server-renders on
  // every request. On a non-production-domain host (the tailnet
  // hostname), Clerk's server-side initialization triggers a
  // protect-rewrite to a synthetic /clerk_<id> path — which 404s,
  // and on the client redirects to accounts.guru-ai.org. This
  // happens directly from the layout, bypassing any guards in
  // src/middleware.ts (which Next 16 doesn't reliably compile in
  // standalone-output mode anyway). Skipping ClerkProvider entirely
  // on tailnet prevents Clerk from initializing there. Admin auth
  // on tailnet lives in Caddy + requireAdmin() (src/lib/admin.ts)
  // and doesn't need Clerk.
  //
  // Reading headers() makes the root layout dynamic, which forces
  // every page underneath to be server-rendered on demand instead
  // of statically prerendered. That's a perf cost but the only
  // alternative on free-plan Clerk is keeping admin permanently
  // broken on tailnet.
  const host = (await headers()).get('host');
  const isTailnet = host === TAILNET_HOST;

  // Design tokens ride <html> as CSS custom properties so globals.css
  // primitives (.btn, .row, focus ring, …) consume the exact values
  // components import from tokens.ts — one source of truth, no drift.
  const tree = (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable}`}
      style={tokensToCssVars() as React.CSSProperties}
    >
      <body>{children}</body>
    </html>
  );

  return isTailnet ? tree : (
    <ClerkProvider appearance={clerkAppearance}>{tree}</ClerkProvider>
  );
}
