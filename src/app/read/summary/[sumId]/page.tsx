/**
 * src/app/read/summary/[sumId]/page.tsx
 *
 * Summary-node viewer — the link target for study-mode citations (tier
 * 'summary', ids like `sum:{text_id}:{span}` / `sum:{work_id}`), so a
 * summary citation always links through to primary evidence: level-1 span
 * summaries list their child passages, level-2 whole-work summaries list
 * the work's member texts. The param is the URI-encoded summary id (colons
 * survive encoding; the static `summary` segment wins over /read/[tradition]).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getSummaryPage, getChunkSections, listWorkMembers } from '@/lib/reader';
import { chunkIdToPath } from '@/lib/read-path';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

type Params = Promise<{ sumId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { sumId } = await params;
  const node = await getSummaryPage(decodeURIComponent(sumId));
  if (!node) return { title: 'Not found — Guru' };
  const scope = node.level === 2 ? node.work_label : `${node.text_label}${node.section_span ? `, ${node.section_span}` : ''}`;
  return {
    title: `Summary: ${scope} — Guru`,
    description: node.body.slice(0, 160),
    robots: { index: false }, // study apparatus — canonical content is the chunks
  };
}

export default async function SummaryPage({ params }: { params: Params }) {
  const { sumId } = await params;
  const id = decodeURIComponent(sumId);
  if (!id.startsWith('sum:')) notFound();
  const node = await getSummaryPage(id);
  if (!node) notFound();

  const [children, members] = await Promise.all([
    node.level === 1 ? getChunkSections(node.child_chunk_ids) : Promise.resolve([]),
    node.level === 2 ? listWorkMembers(node.work_id) : Promise.resolve([]),
  ]);

  const color = tokens.tradition[node.tradition as keyof typeof tokens.tradition] ?? tokens.text.secondary;
  const crumbStyle = {
    fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.link,
    letterSpacing: 1, textDecoration: 'none', textTransform: 'uppercase',
  } as const;

  return (
    <main style={{ minHeight: '100vh', background: tokens.bg.deep, padding: '64px 24px' }}>
      <article style={{ maxWidth: 680, margin: '0 auto' }}>
        <nav style={{ marginBottom: 24 }}>
          <Link href="/read" style={crumbStyle}>Library</Link>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}> / </span>
          <Link href={`/read/${node.tradition}`} style={crumbStyle}>{node.tradition_label}</Link>
          {node.text_id && (
            <>
              <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}> / </span>
              <Link href={`/read/${node.tradition}/${node.text_id}`} style={crumbStyle}>{node.text_label}</Link>
            </>
          )}
        </nav>

        <header style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.tier.summary, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>
            § Generated summary · {node.level === 2 ? 'whole work' : 'section'}
          </div>
          <h1 style={{ fontFamily: tokens.font.display, fontSize: 28, fontWeight: 600, color: tokens.text.primary, margin: 0, lineHeight: 1.2 }}>
            {node.level === 2 ? node.work_label : `${node.text_label}${node.section_span ? ` — ${node.section_span}` : ''}`}
          </h1>
        </header>

        <div
          style={{
            borderLeft: `2px solid ${tokens.tier.summary}`,
            paddingLeft: 18,
            fontFamily: tokens.font.display,
            fontSize: 16,
            color: tokens.text.primary,
            lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
          }}
        >
          {node.body}
        </div>

        <section style={{ marginTop: 36 }}>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
            {node.level === 2 ? 'Read the source texts' : 'Read the source passages'}
          </div>
          {node.level === 2
            ? members.map(m => (
                <Link key={m.id} href={`/read/${m.tradition}/${m.id}`} style={{ display: 'block', padding: '6px 0', fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.link, textDecoration: 'none' }}>
                  {m.label}
                </Link>
              ))
            : children.map(c => {
                const href = chunkIdToPath(c.id);
                if (!href) return null;
                return (
                  <Link key={c.id} href={href} style={{ display: 'block', padding: '6px 0', fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.link, textDecoration: 'none', borderLeft: `2px solid ${color}`, paddingLeft: 12, marginBottom: 4 }}>
                    {c.section ?? c.id}
                    <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginLeft: 8 }}>{c.text_name}</span>
                  </Link>
                );
              })}
        </section>
      </article>
    </main>
  );
}
