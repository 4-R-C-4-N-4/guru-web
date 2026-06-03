/**
 * src/app/blog/page.tsx
 *
 * Public blog index (IMPL T8). Server-rendered, no auth — a page that never
 * calls requireUser is public (proxy.ts runs Clerk as a pass-through). Lists
 * only `published` posts, newest first, as title + dek cards.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { listPublished } from '@/lib/blog-public';
import EssayCard from '@/components/essay-card';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Essays — Guru',
  description:
    'Grounded essays tracing resonances across esoteric traditions, every claim cited to its source.',
};

export default async function BlogIndexPage() {
  const posts = await listPublished();

  return (
    <main
      style={{
        minHeight: '100vh',
        background: tokens.bg.deep,
        padding: '64px 24px',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <header style={{ marginBottom: 48 }}>
          <Link
            href="/"
            style={{
              fontFamily: tokens.font.display,
              fontSize: 40,
              fontWeight: 300,
              color: tokens.text.accent,
              letterSpacing: 8,
              textDecoration: 'none',
            }}
          >
            GURU
          </Link>
          <div
            style={{
              fontFamily: tokens.font.mono,
              fontSize: 11,
              color: tokens.text.muted,
              letterSpacing: 3,
              marginTop: 8,
              textTransform: 'uppercase',
            }}
          >
            Essays
          </div>
        </header>

        {posts.length === 0 ? (
          <p
            style={{
              fontFamily: tokens.font.display,
              fontSize: 16,
              color: tokens.text.secondary,
              fontStyle: 'italic',
            }}
          >
            No essays published yet.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {posts.map(post => (
              <li key={post.slug} style={{ marginBottom: 36 }}>
                <EssayCard post={post} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
