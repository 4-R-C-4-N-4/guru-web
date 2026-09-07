/**
 * src/components/guest-convert.tsx
 *
 * Finishes the guest→account conversion after signup (todo:45598ce4).
 *
 * The signup wall sends a signed-out visitor to Clerk with
 * redirect_url=/ask?continue=1. Clerk returns them here; this component
 * (rendered by /ask ONLY when ClerkProvider is present) detects the
 * ?continue=1 marker and, once Clerk reports the user signed in, POSTs
 * /api/guest/convert to adopt their anonymous question into a real
 * session, then lands them on /chat/[sessionId] — picking up exactly where
 * they left off, rather than an empty app.
 *
 * Mirrors continue-button.tsx's guards: all work runs inside a deferred
 * tick (StrictMode double-mount safe), the ?continue=1 param is stripped
 * via replaceState (refresh-safe), and a sessionStorage flag dedupes the
 * auto-trigger (bfcache-safe).
 */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';

const GUARD_KEY = 'guru:guest-converted';

export default function GuestConvert() {
  const router = useRouter();
  const { isSignedIn } = useUser();
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return; // undefined while Clerk loads — wait

    const t = setTimeout(async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('continue') !== '1') return;

      // Strip the marker first (refresh-safe) and dedupe (bfcache-safe).
      params.delete('continue');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
      if (sessionStorage.getItem(GUARD_KEY)) return;
      sessionStorage.setItem(GUARD_KEY, '1');

      setRestoring(true);
      try {
        const res = await fetch('/api/guest/convert', { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (res.ok && (body as { adopted?: boolean }).adopted) {
          router.push(`/chat/${(body as { sessionId: string }).sessionId}`);
        } else {
          // Nothing to adopt (cookie cleared, already converted) — just
          // drop them into the app.
          router.push('/chat');
        }
      } catch {
        router.push('/chat');
      }
    }, 0);

    return () => clearTimeout(t);
  }, [isSignedIn, router]);

  if (!restoring) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: tokens.bg.deep,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        fontFamily: tokens.font.mono,
        fontSize: 12,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: tokens.text.muted,
      }}
    >
      Restoring your conversation…
    </div>
  );
}
