/**
 * src/app/read/[tradition]/page.tsx
 *
 * Texts of one tradition, grouped by work in reading order. Single-member
 * works render as one row; grouped works (Dhammapada's 26 chapter-texts)
 * render as a card with ordered parts. Unknown tradition slugs 404.
 */

import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { listTextsForTradition, listTraditionsForReader } from '@/lib/reader';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

// Deduped across generateMetadata and the page render (todo:17621cef).
const listTraditionsForReaderCached = cache(listTraditionsForReader);
const listTextsForTraditionCached = cache(listTextsForTradition);

export async function generateMetadata(
  { params }: { params: Promise<{ tradition: string }> },
): Promise<Metadata> {
  const { tradition } = await params;
  const traditions = await listTraditionsForReaderCached();
  const t = traditions.find(x => x.id === tradition);
  if (!t) return { title: 'Not found — Guru' };
  return {
    title: `${t.label} — Source Library — Guru`,
    description: t.description ?? `Primary sources of the ${t.label} tradition, readable passage by passage.`,
    alternates: { canonical: `/read/${tradition}` },
  };
}

export default async function TraditionPage(
  { params }: { params: Promise<{ tradition: string }> },
) {
  const { tradition } = await params;
  const [works, traditions] = await Promise.all([
    listTextsForTraditionCached(tradition),
    listTraditionsForReaderCached(),
  ]);
  const meta = traditions.find(t => t.id === tradition);
  if (works.length === 0 || !meta) notFound();

  const color = tokens.tradition[tradition as keyof typeof tokens.tradition] ?? tokens.text.secondary;
  const crumbStyle = {
    fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.link,
    letterSpacing: 1, textDecoration: 'none', textTransform: 'uppercase',
  } as const;

  return (
    <main style={{ minHeight: '100vh', background: tokens.bg.deep, padding: '64px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <nav style={{ marginBottom: 24 }}>
          <Link href="/read" style={crumbStyle}>Library</Link>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}> / </span>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted, letterSpacing: 1, textTransform: 'uppercase' }}>
            {meta.label}
          </span>
        </nav>

        <header style={{ marginBottom: 40, borderLeft: `2px solid ${color}`, paddingLeft: 18 }}>
          <h1 style={{ fontFamily: tokens.font.display, fontSize: 34, fontWeight: 600, color: tokens.text.primary, margin: 0, lineHeight: 1.2 }}>
            {meta.label}
          </h1>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 1, marginTop: 6 }}>
            {meta.texts} {meta.texts === 1 ? 'text' : 'texts'} · {meta.chunks.toLocaleString()} passages
          </div>
          {meta.description && (
            <p style={{ fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.secondary, lineHeight: 1.7, margin: '10px 0 0', fontStyle: 'italic' }}>
              {meta.description}
            </p>
          )}
        </header>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {works.map(w => (
            <li key={w.work_id} style={{ marginBottom: 16 }}>
              {w.texts.length === 1 ? (
                <Link
                  href={`/read/${tradition}/${w.texts[0].text_id}`}
                  style={{ display: 'block', textDecoration: 'none', background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, padding: '12px 16px' }}
                >
                  <span style={{ fontFamily: tokens.font.display, fontSize: 18, color: tokens.text.primary }}>
                    {w.texts[0].label}
                  </span>
                  <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginLeft: 10 }}>
                    {w.texts[0].chunks} passages{w.texts[0].translator ? ` · tr. ${w.texts[0].translator}` : ''}
                  </span>
                </Link>
              ) : (
                <div style={{ background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, padding: '12px 16px' }}>
                  <div style={{ fontFamily: tokens.font.display, fontSize: 18, color: tokens.text.primary, marginBottom: 8 }}>
                    {w.work_label}
                    <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginLeft: 10 }}>
                      {w.texts.length} parts · {w.texts.reduce((n, t) => n + t.chunks, 0)} passages
                    </span>
                  </div>
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {w.texts.map(t => (
                      <li key={t.text_id}>
                        <Link
                          href={`/read/${tradition}/${t.text_id}`}
                          style={{ display: 'block', padding: '3px 0', fontFamily: tokens.font.display, fontSize: 14, color: tokens.text.link, textDecoration: 'none' }}
                        >
                          {t.label}
                          <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginLeft: 8 }}>
                            {t.chunks}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
