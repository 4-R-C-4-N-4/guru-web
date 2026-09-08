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

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';

const GUARD_KEY = 'guru:guest-converted';

export default function GuestConvert() {
  const router = useRouter();
  const { isSignedIn } = useUser();
  const [restoring, setRestoring] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isSignedIn) return; // undefined while Clerk loads — wait

    const t = setTimeout(async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('continue') !== '1') return;
      // Persistent "already done" guard (bfcache-safe) + in-flight guard
      // (StrictMode double-mount / concurrent). Neither the guard NOR the URL
      // marker is touched until a convert actually SUCCEEDS — so a transient
      // failure leaves both intact and a reload can retry, rather than
      // silently abandoning the just-signed-up user's question.
      if (sessionStorage.getItem(GUARD_KEY)) return;
      if (inFlight.current) return;
      inFlight.current = true;

      setFailed(false);
      setRestoring(true);
      try {
        const res = await fetch('/api/guest/convert', { method: 'POST' });
        if (!res.ok) throw new Error(`convert ${res.status}`);
        const body = await res.json().catch(() => ({})) as { adopted?: boolean; sessionId?: string };

        // Confirmed success — NOW commit: mark done + strip the marker so a
        // refresh won't re-fire, then route.
        sessionStorage.setItem(GUARD_KEY, '1');
        params.delete('continue');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));

        if (body.adopted && body.sessionId) router.push(`/chat/${body.sessionId}`);
        else router.push('/chat'); // nothing to adopt (cookie cleared / already converted)
      } catch {
        // Transient failure — leave the marker + guard untouched so a reload
        // retries. Surface a retry affordance instead of dropping the question.
        inFlight.current = false;
        setRestoring(false);
        setFailed(true);
      }
    }, 0);

    return () => clearTimeout(t);
  }, [isSignedIn, router]);

  if (!restoring && !failed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: tokens.bg.deep,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        zIndex: 200,
        fontFamily: tokens.font.mono,
        fontSize: 12,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: tokens.text.muted,
      }}
    >
      {failed ? (
        <>
          <span>Couldn&apos;t restore your conversation.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn btn-primary"
            style={{ padding: '10px 20px', letterSpacing: 1 }}
          >
            Retry
          </button>
        </>
      ) : (
        <span>Restoring your conversation…</span>
      )}
    </div>
  );
}
