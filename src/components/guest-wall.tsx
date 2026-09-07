/**
 * src/components/guest-wall.tsx
 *
 * The signup wall shown after a guest's free question (todo:f138c9ad).
 * Rendered BELOW the answer, never over it — the visitor reads the real
 * Guru answer first, and this is the highest-intent moment to convert.
 *
 * This is the minimal version that ships with the public /ask surface.
 * The Clerk sign-up wiring and the "carry my question into the account"
 * conversation-preservation flow are layered on in todo:97cb0222 /
 * todo:45598ce4, which replace the plain links below with Clerk controls.
 */
'use client';

import Link from 'next/link';
import { tokens } from '@/styles/tokens';

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
        {message ?? 'Create a free account to keep exploring Guru.'}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link href="/sign-up" className="btn btn-primary" style={{ padding: '10px 20px', letterSpacing: 1 }}>
          Create free account
        </Link>
        <Link href="/sign-in" className="btn" style={{ padding: '10px 20px', letterSpacing: 1 }}>
          Sign in
        </Link>
      </div>
    </div>
  );
}
