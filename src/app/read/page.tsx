/**
 * src/app/read/page.tsx
 *
 * Source library index — the browse entry point for the reader. Public,
 * server-rendered (like /atlas). Lists every tradition in the corpus with
 * its color, description and text/passage counts, linking into
 * /read/[tradition]. An empty corpus renders as an explicit empty state,
 * never a hardcoded list (same rule as listTraditions in corpus.ts).
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { listTraditionsForReader } from '@/lib/reader';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Source Library — Guru',
  description:
    'Browse the primary sources behind every answer: complete texts from 21 contemplative traditions, readable passage by passage with cross-tradition parallels.',
};

export default async function ReadIndexPage() {
  const traditions = await listTraditionsForReader();

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
            Source Library
          </div>
          {traditions.length > 0 && (
            <div aria-hidden style={{ display: 'flex', gap: 1, height: 2, width: 220, marginTop: 12, borderRadius: 1, overflow: 'hidden' }}>
              {traditions.map(t => (
                <div key={t.id} style={{
                  flex: 1,
                  background: tokens.tradition[t.id as keyof typeof tokens.tradition] ?? tokens.text.secondary,
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
          The complete corpus, readable passage by passage — every text the
          retriever cites, with its themes and cross-tradition parallels.
        </p>

        {traditions.length === 0 ? (
          <p style={{ fontFamily: tokens.font.display, fontSize: 16, color: tokens.text.secondary, fontStyle: 'italic' }}>
            The corpus is not loaded.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {traditions.map(t => {
              const color = tokens.tradition[t.id as keyof typeof tokens.tradition] ?? tokens.text.secondary;
              return (
                <li key={t.id} style={{ marginBottom: 12 }}>
                  <Link
                    href={`/read/${t.id}`}
                    style={{
                      display: 'block',
                      textDecoration: 'none',
                      borderLeft: `2px solid ${color}`,
                      background: `${color}08`,
                      padding: '14px 18px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: tokens.font.display, fontSize: 20, fontWeight: 600, color: tokens.text.primary }}>
                        {t.label}
                      </span>
                      <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 1 }}>
                        {t.texts} {t.texts === 1 ? 'text' : 'texts'} · {t.chunks.toLocaleString()} passages
                      </span>
                    </div>
                    {t.description && (
                      <div style={{ fontFamily: tokens.font.display, fontSize: 14, color: tokens.text.secondary, lineHeight: 1.6, marginTop: 4 }}>
                        {t.description}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
