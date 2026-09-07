/**
 * src/components/guest-wall.tsx
 *
 * The signup wall shown after a guest's free question (todo:f138c9ad).
 * Rendered BELOW the answer, never over it — the visitor reads the real
 * Guru answer first, and this is the highest-intent moment to convert.
 *
 * The buttons route to Clerk's sign-up / sign-in with a redirect_url that
 * brings the visitor back to /ask?continue=1 after auth (todo:97cb0222).
 * Clerk honours redirect_url over the page's fallbackRedirectUrl, so the
 * return trip lands here, where the conversion effect adopts their guest
 * question into the new account (todo:45598ce4). The redirect_url wiring is
 * all this component needs — it stays hook-free so it renders even without
 * ClerkProvider (e.g. the tailnet host), where the links simply lead to the
 * standard auth pages.
 */
'use client';

import Link from 'next/link';
import { tokens } from '@/styles/tokens';

// After auth, come back to the ask page and finish the conversion. The
// ?continue=1 marker is what the conversion effect keys on.
const RETURN_TO = '/ask?continue=1';
const SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent(RETURN_TO)}`;
const SIGN_IN_HREF = `/sign-in?redirect_url=${encodeURIComponent(RETURN_TO)}`;

export default function GuestWall({ message }: { message?: string }) {
  return (
    <div
      style={{
        maxWidth: 680,
        margin: '28px auto 0',
        padding: '20px 24px',
        background: tokens.bg.surface,
        border: `1px solid ${tokens.border.subtle}`,
        borderRadius: 6,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontFamily: tokens.font.mono,
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: tokens.text.muted,
          marginBottom: 8,
        }}
      >
        Free question used
      </div>
      <div
        style={{
          fontFamily: tokens.font.display,
          fontSize: 18,
          color: tokens.text.primary,
          lineHeight: 1.5,
          marginBottom: 16,
        }}
      >
        {message ?? "You've used your free question — create a free account to keep exploring."}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href={SIGN_UP_HREF} className="btn btn-primary" style={{ padding: '10px 20px', letterSpacing: 1 }}>
          Create free account
        </Link>
        <Link href={SIGN_IN_HREF} className="btn" style={{ padding: '10px 20px', letterSpacing: 1 }}>
          Sign in
        </Link>
      </div>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginTop: 12 }}>
        Your question and its answer carry over — you&apos;ll pick up right where you left off.
      </div>
    </div>
  );
}
