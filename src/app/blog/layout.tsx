/**
 * src/app/blog/layout.tsx
 *
 * Shared chrome for the public blog (todo:3eb7c659). The blog routes were
 * fully isolated — a reader who landed on an essay had no way back into the
 * app. This persistent top bar renders an auth-aware home button on every
 * blog route (index + post). Server component; the button is the only client
 * island.
 *
 * On the tailnet host the root layout skips ClerkProvider, so the useUser()
 * inside BlogHomeButton would throw and crash the (public) blog. Gate on
 * clerkEnabled() and fall back to a static link there — sign-in is dead on
 * tailnet anyway, so the landing page is the sensible target (todo:3eb7c659).
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

export default async function BlogLayout({ children }: { children: ReactNode }) {
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
