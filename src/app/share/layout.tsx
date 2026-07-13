/**
 * src/app/share/layout.tsx
 *
 * Chrome for public shared-chat pages (todo:47067537). Same shape and
 * rationale as blog/layout.tsx: these routes are public and live outside
 * the (app) group, so they must not assume ClerkProvider — on the tailnet
 * host the root layout skips it and the auth-aware home button would
 * crash. Gate on clerkEnabled() and fall back to a static link there.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import BlogHomeButton from '@/components/blog-home-button';
import { clerkEnabled } from '@/lib/host';
import { tokens } from '@/styles/tokens';

const HOME_LINK_STYLE = {
  fontFamily: tokens.font.mono,
  fontSize: 11,
  color: tokens.text.link,
  letterSpacing: 1,
  textDecoration: 'none',
  textTransform: 'uppercase',
} as const;

export default async function ShareLayout({ children }: { children: ReactNode }) {
  const clerk = await clerkEnabled();

  return (
    <div style={{ background: tokens.bg.deep, minHeight: '100vh' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 24px',
          borderBottom: `1px solid ${tokens.border.subtle}`,
          background: tokens.bg.surface,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        {clerk ? (
          <BlogHomeButton />
        ) : (
          <Link href="/" style={HOME_LINK_STYLE}>
            ← Home
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}
