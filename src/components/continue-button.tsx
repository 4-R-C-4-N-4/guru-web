'use client';

/**
 * src/components/continue-button.tsx
 *
 * "Continue this conversation" on the public share page (todo:a4077cc9,
 * parent todo:36421ff5).
 *
 * Signed-in visitor: POST /api/shares/[slug]/fork → land on the new
 * /chat/[sessionId] they now own.
 *
 * Signed-out visitor: bounce through /sign-in with
 * redirect_url=/share/[slug]?continue=1 — the sign-in page's
 * fallbackRedirectUrl only fires when redirect_url is absent
 * (todo:7069e9aa), so auth returns them here and the ?continue=1 effect
 * finishes the fork they asked for. Sign-up is reachable from the
 * sign-in screen, so one entry point covers both.
 *
 * Double-fork guards: the auto-trigger strips ?continue=1 via
 * history.replaceState (refresh-safe) AND records the slug in
 * sessionStorage (back/forward-cache-safe). A deliberate second click of
 * the button still forks — only the automatic path is deduped.
 *
 * Rendered by the share page ONLY when clerkEnabled() — on the tailnet
 * host there is no ClerkProvider and useUser() would crash (same gate as
 * blog's home button).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';

export default function ContinueButton({ slug }: { slug: string }) {
  const router = useRouter();
  const { isSignedIn } = useUser();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const fork = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shares/${slug}/fork`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `Could not continue (${res.status})`);
        inFlight.current = false;
        return;
      }
      router.push(`/chat/${(body as { sessionId: string }).sessionId}`);
    } catch {
      setError('Could not continue — network error');
      inFlight.current = false;
    } finally {
      setBusy(false);
    }
  }, [slug, router]);

  const onClick = useCallback(() => {
    if (isSignedIn) {
      void fork();
    } else {
      const back = encodeURIComponent(`/share/${slug}?continue=1`);
      router.push(`/sign-in?redirect_url=${back}`);
    }
  }, [isSignedIn, fork, router, slug]);

  // Finish the fork a signed-out visitor started: they clicked Continue,
  // authed, and Clerk sent them back with ?continue=1.
  useEffect(() => {
    if (!isSignedIn) return; // undefined while Clerk loads — wait, don't consume the param
    const params = new URLSearchParams(window.location.search);
    if (params.get('continue') !== '1') return;

    params.delete('continue');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));

    const guard = `guru:forked:${slug}`;
    if (sessionStorage.getItem(guard)) return;
    sessionStorage.setItem(guard, '1');
    void fork();
  }, [isSignedIn, slug, fork]);

  return (
    <div style={{ marginTop: 48, textAlign: 'center' }}>
      {error && (
        <p role="alert" style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.error, marginBottom: 12 }}>
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          fontFamily: tokens.font.mono,
          fontSize: 12,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: tokens.bg.deep,
          background: tokens.text.accent,
          border: 'none',
          borderRadius: 3,
          padding: '12px 28px',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Continuing…' : 'Continue this conversation'}
      </button>
      {!isSignedIn && (
        <p style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginTop: 10 }}>
          You&apos;ll be asked to sign in — the conversation picks up right here.
        </p>
      )}
    </div>
  );
}
