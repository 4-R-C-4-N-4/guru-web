/**
 * src/app/read/[tradition]/[textId]/page.tsx
 *
 * Text table of contents. When the text has level-1 span summaries, the
 * section list is grouped into a study outline — each span shows its label
 * and synopsis with its passages beneath; texts without summaries fall back
 * to the flat ordered list. A whole-work (level-2) summary renders as an
 * "About this work" disclosure at the top. Guard: the URL tradition must
 * match the text's actual tradition, so each text has exactly one canonical
 * URL and mistyped traditions 404 instead of duplicating pages.
 */

import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTextToc, type SpanSummary, type TocEntry } from '@/lib/reader';
import { sectionFormatLabel } from '@/lib/read-path';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

// Deduped across generateMetadata and the page render (todo:17621cef).
const getTextTocCached = cache(getTextToc);

export async function generateMetadata(
  { params }: { params: Promise<{ tradition: string; textId: string }> },
): Promise<Metadata> {
  const { tradition, textId } = await params;
  const data = await getTextTocCached(textId);
  if (!data || data.text.tradition !== tradition) return { title: 'Not found — Guru' };
  return {
    title: `${data.text.label} — Source Library — Guru`,
    description: `${data.text.label} (${data.text.tradition_label}), readable passage by passage${data.text.translator ? `, translated by ${data.text.translator}` : ''}.`,
    alternates: { canonical: `/read/${tradition}/${textId}` },
  };
}

function chunkPath(tradition: string, textId: string, chunkId: string): string {
  return `/read/${tradition}/${textId}/${chunkId.slice(chunkId.lastIndexOf('.') + 1)}`;
}

export default async function TextTocPage(
  { params }: { params: Promise<{ tradition: string; textId: string }> },
) {
  const { tradition, textId } = await params;
  const data = await getTextTocCached(textId);
  if (!data || data.text.tradition !== tradition || data.toc.length === 0) notFound();
  const { text, toc, spans, workSummary } = data;

  const color = tokens.tradition[tradition as keyof typeof tokens.tradition] ?? tokens.text.secondary;
  const crumbStyle = {
    fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.link,
    letterSpacing: 1, textDecoration: 'none', textTransform: 'uppercase',
  } as const;
  const entryStyle = {
    display: 'block', padding: '5px 0', fontFamily: tokens.font.display,
    fontSize: 15, color: tokens.text.link, textDecoration: 'none',
  } as const;

  // Group the ordered chunk list by span summaries: a span block renders at
  // the position of its first chunk; chunks covered by a span render inside
  // it; chunks no span claims stay in the top-level flow. Degrades to the
  // flat list when the text has no summaries.
  const tocById = new Map(toc.map(e => [e.id, e]));
  const spanByFirstChunk = new Map<string, SpanSummary>();
  const spanned = new Set<string>();
  for (const s of spans) {
    if (s.child_chunk_ids.length > 0) spanByFirstChunk.set(s.child_chunk_ids[0], s);
    for (const c of s.child_chunk_ids) spanned.add(c);
  }

  const memberIds = text.member_text_ids;
  const memberIdx = memberIds.indexOf(textId);
  const isGroupedWork = memberIds.length > 1;

  const renderEntry = (entry: TocEntry) => (
    <Link key={entry.id} href={chunkPath(tradition, textId, entry.id)} style={entryStyle}>
      {entry.section ?? entry.id}
    </Link>
  );

  return (
    <main style={{ minHeight: '100vh', background: tokens.bg.deep, padding: '64px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <nav style={{ marginBottom: 24 }}>
          <Link href="/read" style={crumbStyle}>Library</Link>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}> / </span>
          <Link href={`/read/${tradition}`} style={crumbStyle}>{text.tradition_label}</Link>
        </nav>

        <header style={{ marginBottom: 32, borderLeft: `2px solid ${color}`, paddingLeft: 18 }}>
          <h1 style={{ fontFamily: tokens.font.display, fontSize: 32, fontWeight: 600, color: tokens.text.primary, margin: 0, lineHeight: 1.2 }}>
            {text.label}
          </h1>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 1, marginTop: 6 }}>
            {isGroupedWork && <>{text.work_label} · part {memberIdx + 1} of {memberIds.length} · </>}
            {toc.length} passages{text.translator ? ` · tr. ${text.translator}` : ''}
          </div>
          <Link
            href={chunkPath(tradition, textId, toc[0].id)}
            style={{ display: 'inline-block', marginTop: 14, fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.accent, letterSpacing: 1, textDecoration: 'none', textTransform: 'uppercase' }}
          >
            Begin reading →
          </Link>
        </header>

        {workSummary && (
          <details style={{ marginBottom: 28, background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, padding: '10px 16px' }}>
            <summary style={{ cursor: 'pointer', fontFamily: tokens.font.mono, fontSize: 10, color: tokens.tier.summary, letterSpacing: 1, textTransform: 'uppercase' }}>
              § About this work
            </summary>
            <p style={{ fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.secondary, lineHeight: 1.7, margin: '10px 0 4px', whiteSpace: 'pre-wrap' }}>
              {workSummary.body}
            </p>
          </details>
        )}

        <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
          {sectionFormatLabel(text.sections_format)}
        </div>

        <div>
          {toc.map(entry => {
            const span = spanByFirstChunk.get(entry.id);
            if (span) {
              const children = span.child_chunk_ids
                .map(id => tocById.get(id))
                .filter((e): e is TocEntry => Boolean(e));
              return (
                <div key={span.id} style={{ margin: '14px 0', paddingLeft: 12, borderLeft: `1px solid ${tokens.border.subtle}` }}>
                  {span.section_span && (
                    <div style={{ fontFamily: tokens.font.display, fontSize: 15, fontWeight: 600, color: tokens.text.primary }}>
                      {span.section_span}
                    </div>
                  )}
                  <p style={{ fontFamily: tokens.font.display, fontSize: 13, color: tokens.text.secondary, lineHeight: 1.6, margin: '4px 0 6px', fontStyle: 'italic' }}>
                    {span.body}
                  </p>
                  {children.map(renderEntry)}
                </div>
              );
            }
            if (spanned.has(entry.id)) return null;
            return renderEntry(entry);
          })}
        </div>

        {isGroupedWork && (
          <nav style={{ display: 'flex', justifyContent: 'space-between', marginTop: 40, gap: 16 }}>
            {memberIdx > 0 ? (
              <Link href={`/read/${tradition}/${memberIds[memberIdx - 1]}`} style={crumbStyle}>← Previous part</Link>
            ) : <span />}
            {memberIdx < memberIds.length - 1 ? (
              <Link href={`/read/${tradition}/${memberIds[memberIdx + 1]}`} style={crumbStyle}>Next part →</Link>
            ) : <span />}
          </nav>
        )}

        {text.source_url && (
          <footer style={{ marginTop: 48, paddingTop: 16, borderTop: `1px solid ${tokens.border.subtle}` }}>
            <a href={text.source_url} target="_blank" rel="noreferrer" style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, textDecoration: 'none' }}>
              Source text: {new URL(text.source_url).hostname} →
            </a>
          </footer>
        )}
      </div>
    </main>
  );
}
