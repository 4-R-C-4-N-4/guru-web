'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';

/**
 * Auth-aware exit from the otherwise-isolated public blog (todo:3eb7c659).
 * Signed-in readers return to the app (/chat); anonymous visitors go to the
 * landing page — NOT /sign-in (todo:17621cef): "Home" is the most repeated
 * link on every public page, and pointing it at an auth wall was both a
 * dead end for search visitors and a bad internal-link signal. While Clerk
 * is loading isSignedIn is undefined, so we default to /; a signed-in user
 * who clicks during that window still has the app nav to get back.
 */
export default function BlogHomeButton() {
  const { isSignedIn } = useUser();
  const href = isSignedIn ? '/chat' : '/';

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
