import type { Metadata } from 'next';
import { Cormorant_Garamond, IBM_Plex_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { headers } from 'next/headers';
import { clerkAppearance } from '@/styles/clerk-appearance';
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

/**
 * Hostname of the VPS's tailnet listener (deploy/Caddyfile). Must
 * match exactly — both files need updating together if the tailnet
 * suffix changes.
 */
const TAILNET_HOST = 'guru-web-prod.tailb5626e.ts.net';

export const metadata: Metadata = {
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

  const tree = (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );

  return isTailnet ? tree : (
    <ClerkProvider appearance={clerkAppearance}>{tree}</ClerkProvider>
  );
}
