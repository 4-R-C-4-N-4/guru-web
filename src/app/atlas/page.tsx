/**
 * src/app/atlas/page.tsx
 *
 * Public almanac index for "State of the Atlas" editions (todo:526a20c3).
 * Server-rendered, no auth (like /blog). Lists published atlas editions, newest
 * edition first; each renders through the shared /blog/[slug] post page. A note
 * frames the genre so a reader landing here knows what these editions are.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { listAtlasEditionsCached } from '@/lib/blog-public';
import { listTraditionsCached } from '@/lib/corpus';
import EssayCard from '@/components/essay-card';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'State of the Atlas — Guru',
  description:
    'A recurring, data-led reading of the whole corpus: what the aggregate of cross-tradition resonances says, grounded in primary sources and honest about its method.',
  alternates: { canonical: '/atlas' },
};

export default async function AtlasIndexPage() {
  const [editions, traditions] = await Promise.all([
    listAtlasEditionsCached(),
    listTraditionsCached(),
  ]);

  return (
    <main style={{ minHeight: '100vh', background: tokens.bg.deep, padding: '64px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <header style={{ marginBottom: 32 }}>
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
            State of the Atlas
          </div>
          {/* Corpus spectrum echo — same band as the landing hero and the
              scope page; the atlas reads this exact corpus. No corpus →
              no strip (absence stays visible). */}
          {traditions.length > 0 && (
            <div aria-hidden style={{ display: 'flex', gap: 1, height: 2, width: 220, marginTop: 12, borderRadius: 1, overflow: 'hidden' }}>
              {traditions.map(t => (
                <div key={t} style={{
                  flex: 1,
                  background: tokens.tradition[t as keyof typeof tokens.tradition] ?? tokens.text.secondary,
                  opacity: 0.8,
                }} />
              ))}
            </div>
          )}
        </header>

        <p
          style={{
            fontFamily: tokens.font.display,
            fontSize: 16,
            color: tokens.text.secondary,
            lineHeight: 1.7,
            fontStyle: 'italic',
            marginBottom: 48,
            maxWidth: 600,
          }}
        >
          Each edition reads the corpus as a whole — what the aggregate of cross-tradition
          resonances shows, grounded in primary sources and up front about its method.
        </p>

        {editions.length === 0 ? (
          <p
            style={{
              fontFamily: tokens.font.display,
              fontSize: 16,
              color: tokens.text.secondary,
              fontStyle: 'italic',
            }}
          >
            No editions yet.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {editions.map(edition => (
              <li key={edition.slug} style={{ marginBottom: 36 }}>
                <EssayCard post={edition} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
