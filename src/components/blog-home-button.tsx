'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';

/**
 * Auth-aware exit from the otherwise-isolated public blog (todo:3eb7c659).
 * Signed-in readers return to the app (/chat); anonymous visitors land on
 * the sign-in page. While Clerk is still loading isSignedIn is undefined, so
 * we default to /sign-in — that page redirects already-authenticated users
 * onward to /chat, so the fallback is never a dead end.
 */
export default function BlogHomeButton() {
  const { isSignedIn } = useUser();
  const href = isSignedIn ? '/chat' : '/sign-in';

  return (
    <Link
      href={href}
      style={{
        fontFamily: tokens.font.mono,
        fontSize: 11,
        color: tokens.text.link,
        letterSpacing: 1,
        textDecoration: 'none',
        textTransform: 'uppercase',
      }}
    >
      ← Home
    </Link>
  );
}
