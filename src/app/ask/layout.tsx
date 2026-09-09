/**
 * src/app/ask/layout.tsx
 *
 * Chrome for the public /ask funnel page (todo:f138c9ad). Same shape and
 * rationale as share/layout.tsx: this route is public and lives outside the
 * (app) group, so it must not assume ClerkProvider — on the tailnet host the
 * root layout skips Clerk and an auth-aware control would crash. Gate the
 * sign-in affordance on clerkEnabled() and fall back to a plain link.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { clerkEnabled } from '@/lib/host';
import { tokens } from '@/styles/tokens';

const LINK_STYLE = {
  fontFamily: tokens.font.mono,
  fontSize: 11,
  color: tokens.text.link,
  letterSpacing: 1,
  textDecoration: 'none',
  textTransform: 'uppercase',
} as const;

// After auth, come back to /ask and finish the guest→account conversion
// via the ?continue=1 effect in GuestConvert. Clerk honours redirect_url
// over the page's fallbackRedirectUrl, so this wins for signed-in returns.
const RETURN_TO = '/ask?continue=1';
const SIGN_IN_HREF = `/sign-in?redirect_url=${encodeURIComponent(RETURN_TO)}`;

export default async function AskLayout({ children }: { children: ReactNode }) {
  const clerk = await clerkEnabled();

  return (
    <div style={{ background: tokens.bg.deep, minHeight: '100vh' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: `1px solid ${tokens.border.subtle}`,
          background: tokens.bg.surface,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <Link href="/" style={LINK_STYLE}>← Guru</Link>
        {clerk && (
          <Link href={SIGN_IN_HREF} style={LINK_STYLE}>Sign in</Link>
        )}
      </div>
      {children}
    </div>
  );
}
