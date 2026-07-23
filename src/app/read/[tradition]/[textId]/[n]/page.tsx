/**
 * src/app/read/[tradition]/[textId]/[n]/page.tsx
 *
 * The chunk viewer — one passage per page, the reader's primary unit.
 * Shows the passage body with its section heading, position in the text,
 * concept tags (live EXPRESSES edges) and cross-tradition related passages
 * (PARALLELS/CONTRASTS edges with their stored justifications). Prev/next
 * walk the text in reading order and continue across member texts of a
 * grouped work. Every hop is a plain link, so the browser back button
 * retraces the exploration chain — the breadcrumb answers "where am I",
 * history answers "how did I get here".
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  getChunkPage, getChunkTags, getRelatedPassages,
  type ChunkNav, type RelatedPassage,
} from '@/lib/reader';
import { pathToChunkId, chunkIdToPath, askAboutHref } from '@/lib/read-path';
import { tokens, type Tier } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

const TIER_SYMBOL: Record<string, string> = { verified: '◆', proposed: '◇', inferred: '○', summary: '§' };
const RELATED_VISIBLE = 10;

type Params = Promise<{ tradition: string; textId: string; n: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tradition, textId, n } = await params;
  const chunk = await getChunkPage(pathToChunkId(tradition, textId, n));
  if (!chunk) return { title: 'Not found — Guru' };
  return {
    title: `${chunk.section ?? `Passage ${chunk.pos}`} — ${chunk.text_label} — Guru`,
    description: chunk.body.slice(0, 160),
    openGraph: { type: 'article', title: `${chunk.section ?? `Passage ${chunk.pos}`} — ${chunk.text_label}` },
  };
}

function tierColor(tier: string): string {
  return tokens.tier[tier as Tier] ?? tokens.tier.inferred;
}

function NavLink({ nav, dir }: { nav: ChunkNav | null; dir: 'prev' | 'next' }) {
  if (!nav) return <span />;
  const href = chunkIdToPath(nav.id);
  if (!href) return <span />;
  const label = nav.crossText && nav.textLabel
    ? `${nav.textLabel}${nav.section ? `, ${nav.section}` : ''}`
    : nav.section ?? nav.id;
  return (
    <Link
      href={href}
      style={{
        fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.link,
        letterSpacing: 0.5, textDecoration: 'none', maxWidth: '48%',
        textAlign: dir === 'next' ? 'right' : 'left',
      }}
    >
      {dir === 'prev' ? `← ${label}` : `${label} →`}
    </Link>
  );
}

function RelatedCard({ r }: { r: RelatedPassage }) {
  const href = chunkIdToPath(r.partner_id);
  const color = tokens.tradition[r.tradition as keyof typeof tokens.tradition] ?? tokens.text.secondary;
  const card = (
    <div style={{ borderLeft: `2px solid ${color}`, background: `${color}08`, padding: '10px 14px', margin: '8px 0' }}>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ color: tierColor(r.tier) }}>{TIER_SYMBOL[r.tier] ?? '○'}</span>
        <span style={{ color }}>{r.tradition}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{r.text_name}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{r.section}</span>
        {r.edge_type === 'CONTRASTS' && (
          <span style={{ color: tokens.text.error, letterSpacing: 1, border: `1px solid ${tokens.text.error}`, padding: '0 5px', borderRadius: 2 }}>
            CONTRASTS
          </span>
        )}
      </div>
      <div style={{ fontFamily: tokens.font.display, fontSize: 14, color: tokens.text.primary, fontStyle: 'italic', lineHeight: 1.6 }}>
        &ldquo;{r.preview.trimEnd()}…&rdquo;
      </div>
      {r.annotation && (
        <div style={{ fontFamily: tokens.font.display, fontSize: 13, color: tokens.text.secondary, lineHeight: 1.6, marginTop: 6 }}>
          {r.annotation}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>{card}</Link> : card;
}

export default async function ChunkPage({ params }: { params: Params }) {
  const { tradition, textId, n } = await params;
  const chunkId = pathToChunkId(tradition, textId, n);
  const [chunk, tags, related] = await Promise.all([
    getChunkPage(chunkId),
    getChunkTags(chunkId),
    getRelatedPassages(chunkId),
  ]);
  // The URL tradition/text must be the chunk's own (single canonical URL).
  if (!chunk || chunk.tradition !== tradition || chunk.text_id !== textId) notFound();

  const color = tokens.tradition[tradition as keyof typeof tokens.tradition] ?? tokens.text.secondary;
  const crumbStyle = {
    fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.link,
    letterSpacing: 1, textDecoration: 'none', textTransform: 'uppercase',
  } as const;
  const parallels = related.filter(r => r.edge_type === 'PARALLELS');
  const contrasts = related.filter(r => r.edge_type === 'CONTRASTS');

  return (
    <main style={{ minHeight: '100vh', background: tokens.bg.deep, padding: '48px 24px 64px' }}>
      <article style={{ maxWidth: 680, margin: '0 auto' }}>
        <nav style={{ marginBottom: 20 }}>
          <Link href="/read" style={crumbStyle}>Library</Link>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}> / </span>
          <Link href={`/read/${tradition}`} style={crumbStyle}>{chunk.tradition_label}</Link>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}> / </span>
          <Link href={`/read/${tradition}/${textId}`} style={crumbStyle}>{chunk.text_label}</Link>
        </nav>

        <nav style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 28 }}>
          <NavLink nav={chunk.prev} dir="prev" />
          <NavLink nav={chunk.next} dir="next" />
        </nav>

        <header style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>
            {chunk.text_label} · {chunk.pos} of {chunk.total}
            {chunk.translator && <> · tr. {chunk.translator}</>}
          </div>
          <h1 style={{ fontFamily: tokens.font.display, fontSize: 28, fontWeight: 600, color: tokens.text.primary, margin: 0, lineHeight: 1.2 }}>
            {chunk.section ?? `Passage ${chunk.pos}`}
          </h1>
        </header>

        {/* Chunk bodies are cleaned plain text, not markdown — render verbatim. */}
        <div
          style={{
            borderLeft: `2px solid ${color}`,
            paddingLeft: 18,
            fontFamily: tokens.font.display,
            fontSize: 17,
            color: tokens.text.primary,
            lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
          }}
        >
          {chunk.body}
        </div>

        {/* The funnel loop-closer (todo:7b60b6fb): reader → chat, pinned to
            this passage's work in study mode with the question prefilled. */}
        <Link
          href={askAboutHref(chunk.pin_text_id, chunk.text_label, chunk.section)}
          style={{
            display: 'inline-block', marginTop: 18,
            fontFamily: tokens.font.mono, fontSize: 11, letterSpacing: 1,
            textTransform: 'uppercase', textDecoration: 'none',
            color: tokens.text.accent, border: `1px solid ${tokens.border.accent}`,
            padding: '8px 14px', borderRadius: 3,
          }}
        >
          § Ask Guru about this passage →
        </Link>

        {tags.length > 0 && (
          <section style={{ marginTop: 36 }}>
            <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
              Themes
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {tags.map(t => (
                <details key={t.concept_id} style={{ border: `1px solid ${tokens.border.subtle}`, background: tokens.bg.surface, padding: '6px 12px' }}>
                  <summary style={{ cursor: 'pointer', fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.primary, letterSpacing: 0.5 }}>
                    <span style={{ color: tierColor(t.tier), marginRight: 6 }}>{TIER_SYMBOL[t.tier] ?? '○'}</span>
                    {t.label}
                    {t.domain && <span style={{ color: tokens.text.muted, marginLeft: 8, fontSize: 10 }}>{t.domain}</span>}
                  </summary>
                  <div style={{ padding: '8px 0 4px' }}>
                    {t.definition && (
                      <p style={{ fontFamily: tokens.font.display, fontSize: 13, color: tokens.text.secondary, lineHeight: 1.6, margin: '0 0 6px' }}>
                        {t.definition}
                      </p>
                    )}
                    {t.annotation && (
                      <p style={{ fontFamily: tokens.font.display, fontSize: 13, color: tokens.text.secondary, fontStyle: 'italic', lineHeight: 1.6, margin: '0 0 6px' }}>
                        {t.annotation}
                      </p>
                    )}
                    <Link
                      href={`/read/concepts/${t.concept_id.replace(/^concept\./, '')}`}
                      style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.link, letterSpacing: 1, textDecoration: 'none', textTransform: 'uppercase' }}
                    >
                      All passages →
                    </Link>
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}

        {related.length > 0 && (
          <section style={{ marginTop: 36 }}>
            <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
              Related passages · {parallels.length} parallel{parallels.length === 1 ? '' : 's'}
              {contrasts.length > 0 && <> · {contrasts.length} contrast{contrasts.length === 1 ? '' : 's'}</>}
            </div>
            {related.slice(0, RELATED_VISIBLE).map(r => <RelatedCard key={`${r.edge_type}:${r.partner_id}`} r={r} />)}
            {related.length > RELATED_VISIBLE && (
              <details>
                <summary style={{ cursor: 'pointer', fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.link, letterSpacing: 1, textTransform: 'uppercase', padding: '6px 0' }}>
                  {related.length - RELATED_VISIBLE} more
                </summary>
                {related.slice(RELATED_VISIBLE).map(r => <RelatedCard key={`${r.edge_type}:${r.partner_id}`} r={r} />)}
              </details>
            )}
          </section>
        )}

        <nav style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 44 }}>
          <NavLink nav={chunk.prev} dir="prev" />
          <NavLink nav={chunk.next} dir="next" />
        </nav>

        {chunk.source_url && (
          <footer style={{ marginTop: 40, paddingTop: 14, borderTop: `1px solid ${tokens.border.subtle}` }}>
            <a href={chunk.source_url} target="_blank" rel="noreferrer" style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, textDecoration: 'none' }}>
              Source text: {new URL(chunk.source_url).hostname} →
            </a>
          </footer>
        )}
      </article>
    </main>
  );
}
