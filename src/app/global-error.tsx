/**
 * src/app/global-error.tsx
 *
 * todo:0141c41f — with no error boundary anywhere in src/app, an
 * uncaught client-side exception (e.g. Clerk's Turnstile bot-check
 * throwing on /sign-up) unmounted the tree and left a blank <body>
 * with no way for the user to recover or for us to see it happened.
 * global-error.tsx is the App Router's outermost boundary — it must
 * render its own <html>/<body> since it replaces the root layout
 * when the root layout itself is what threw or is above the failure.
 */
'use client';

import { tokens } from '@/styles/tokens';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100vh',
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          background: tokens.bg.deep,
          color: tokens.text.primary,
          fontFamily: tokens.font.mono,
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <p style={{ color: tokens.text.error }}>
          Something went wrong loading this page.
        </p>
        {error.digest && (
          <p style={{ color: tokens.text.muted, fontSize: '0.85rem' }}>
            Reference: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            background: 'transparent',
            border: `1px solid ${tokens.border.accent}`,
            color: tokens.text.accent,
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: tokens.font.mono,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
