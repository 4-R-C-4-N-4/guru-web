/**
 * src/app/read/layout.tsx
 *
 * Shared chrome for the public source-material reader — same pattern as the
 * blog layout: a persistent top bar with an auth-aware home button so a
 * reader who arrived on a deep chunk link has a way back into the app. On
 * the tailnet host there is no ClerkProvider, so gate on clerkEnabled() and
 * fall back to a static home link (see blog/layout.tsx).
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

export default async function ReadLayout({ children }: { children: ReactNode }) {
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
