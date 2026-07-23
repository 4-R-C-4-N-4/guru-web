/**
 * src/app/read/concepts/[slug]/page.tsx
 *
 * Concept page — where one concept lives across the corpus. A server-
 * rendered radial constellation puts the concept at the center with one
 * node per tradition, area-scaled by how many passages express it; each
 * node links down to that tradition's passage section. Sections are capped
 * (top concepts express in >1,500 passages — an unbounded list shipped a
 * 3 MB page) with a ?t=<tradition> expansion for the full list.
 *
 * Color note: tradition hues are the app-wide entity mapping
 * (tokens.tradition) — identity is never color-alone here; every node
 * carries a direct text label + count in ink tokens, nodes wear a 2px
 * surface ring, and the sections below are the text/table view.
 *
 * The static `concepts` segment wins over the dynamic /read/[tradition]
 * route (no tradition is named "concepts"). Slug = concept id minus the
 * "concept." prefix.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getConcept, listChunksExpressing, type ExpressingChunk } from '@/lib/reader';
import { chunkIdToPath } from '@/lib/read-path';
import { tokens, type Tier } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

const TIER_SYMBOL: Record<string, string> = { verified: '◆', proposed: '◇', inferred: '○' };
const SECTION_CAP = 8;

type Params = Promise<{ slug: string }>;
type Search = Promise<{ t?: string | string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const concept = await getConcept(`concept.${slug}`);
  if (!concept) return { title: 'Not found — Guru' };
  return {
    title: `${concept.label} — Source Library — Guru`,
    description: concept.definition ?? `Passages expressing ${concept.label} across the corpus.`,
  };
}

function traditionColor(slug: string): string {
  return tokens.tradition[slug as keyof typeof tokens.tradition] ?? tokens.text.secondary;
}

interface TraditionGroup { tradition: string; chunks: ExpressingChunk[] }

/**
 * Radial constellation: concept at center, one node per tradition placed
 * evenly around a ring (largest first, from 12 o'clock), node area ∝
 * passage count. Pure SVG, no client JS — hover detail via native <title>,
 * navigation via anchor links to the sections below.
 */
function Constellation({ groups }: { groups: TraditionGroup[] }) {
  const W = 640, H = 540, CX = W / 2, CY = H / 2, RING = 180;
  const max = Math.max(...groups.map(g => g.chunks.length));
  const nodes = groups.map((g, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / groups.length;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const r = 9 + 19 * Math.sqrt(g.chunks.length / max);
    const x = CX + RING * cos, y = CY + RING * sin;
    // Labels sit just beyond the node along its spoke, anchored away from it.
    const lx = CX + (RING + r + 8) * cos, ly = CY + (RING + r + 8) * sin;
    const anchor: 'start' | 'end' | 'middle' = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
    const baseline = sin > 0.5 ? 12 : sin < -0.5 ? -4 : 4;
    return { ...g, r, x, y, lx, ly, anchor, baseline, color: traditionColor(g.tradition) };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Passages per tradition: ${groups.map(g => `${g.tradition} ${g.chunks.length}`).join(', ')}`}
      style={{ width: '100%', maxWidth: 620, height: 'auto', display: 'block', margin: '0 auto' }}
    >
      {nodes.map(n => (
        <line key={`s-${n.tradition}`} x1={CX} y1={CY} x2={n.x} y2={n.y}
          stroke={tokens.border.subtle} strokeWidth={1} />
      ))}
      <circle cx={CX} cy={CY} r={16} fill="none" stroke={tokens.border.accent} strokeWidth={1} />
      <circle cx={CX} cy={CY} r={9} fill={tokens.text.accent} />
      {nodes.map(n => (
        <a key={n.tradition} href={`#t-${n.tradition}`}>
          <g style={{ cursor: 'pointer' }}>
            <title>{`${n.tradition}: ${n.chunks.length} passage${n.chunks.length === 1 ? '' : 's'}`}</title>
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} fillOpacity={0.85}
              stroke={tokens.bg.deep} strokeWidth={2} />
            <text x={n.lx} y={n.ly + n.baseline} textAnchor={n.anchor}
              fontFamily={tokens.font.mono} fontSize={10} fill={tokens.text.secondary}>
              {n.tradition}
            </text>
            <text x={n.lx} y={n.ly + n.baseline + 12} textAnchor={n.anchor}
              fontFamily={tokens.font.mono} fontSize={9} fill={tokens.text.muted}>
              {n.chunks.length}
            </text>
          </g>
        </a>
      ))}
    </svg>
  );
}

export default async function ConceptPage(
  { params, searchParams }: { params: Params; searchParams: Search },
) {
  const [{ slug }, { t }] = await Promise.all([params, searchParams]);
  const expanded = typeof t === 'string' ? t : undefined;
  const conceptId = `concept.${slug}`;
  const [concept, chunks] = await Promise.all([
    getConcept(conceptId),
    listChunksExpressing(conceptId),
  ]);
  if (!concept) notFound();

  // Group by tradition, largest first; tier-then-id order kept within each.
  const byTradition = new Map<string, ExpressingChunk[]>();
  for (const c of chunks) {
    const list = byTradition.get(c.tradition) ?? [];
    list.push(c);
    byTradition.set(c.tradition, list);
  }
  const groups: TraditionGroup[] = [...byTradition.entries()]
    .map(([tradition, list]) => ({ tradition, chunks: list }))
    .sort((a, b) => b.chunks.length - a.chunks.length);

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
            Concept
          </span>
        </nav>

        <header style={{ marginBottom: 12 }}>
          {concept.domain && (
            <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>
              {concept.domain}
            </div>
          )}
          <h1 style={{ fontFamily: tokens.font.display, fontSize: 34, fontWeight: 600, color: tokens.text.primary, margin: 0, lineHeight: 1.2 }}>
            {concept.label}
          </h1>
          {concept.definition && (
            <p style={{ fontFamily: tokens.font.display, fontSize: 16, color: tokens.text.secondary, lineHeight: 1.7, margin: '12px 0 0', fontStyle: 'italic', maxWidth: 600 }}>
              {concept.definition}
            </p>
          )}
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 1, marginTop: 10 }}>
            {chunks.length.toLocaleString()} passages · {groups.length} traditions
          </div>
        </header>

        {groups.length > 0 && <Constellation groups={groups} />}

        {groups.map(({ tradition, chunks: list }) => {
          const color = traditionColor(tradition);
          const isExpanded = expanded === tradition;
          const visible = isExpanded ? list : list.slice(0, SECTION_CAP);
          return (
            <section key={tradition} id={`t-${tradition}`} style={{ marginBottom: 28, scrollMarginTop: 60 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, borderBottom: `1px solid ${tokens.border.subtle}`, paddingBottom: 4, marginBottom: 8 }}>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: color, alignSelf: 'center' }} />
                <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color, letterSpacing: 2, textTransform: 'uppercase' }}>
                  {tradition}
                </span>
                <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted }}>
                  {list.length}
                </span>
              </div>
              {visible.map(c => {
                const href = chunkIdToPath(c.id);
                if (!href) return null;
                return (
                  <Link key={c.id} href={href} style={{ display: 'block', textDecoration: 'none', padding: '8px 0', borderBottom: `1px solid ${tokens.bg.raised}` }}>
                    <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginBottom: 3 }}>
                      <span style={{ color: tokens.tier[c.tier as Tier] ?? tokens.tier.inferred, marginRight: 6 }}>{TIER_SYMBOL[c.tier] ?? '○'}</span>
                      {c.text_name}{c.section ? ` | ${c.section}` : ''}
                    </div>
                    <div style={{ fontFamily: tokens.font.display, fontSize: 13, color: tokens.text.secondary, fontStyle: 'italic', lineHeight: 1.5 }}>
                      &ldquo;{c.preview.trimEnd()}…&rdquo;
                    </div>
                  </Link>
                );
              })}
              {list.length > SECTION_CAP && (
                <Link
                  href={isExpanded ? `/read/concepts/${slug}#t-${tradition}` : `/read/concepts/${slug}?t=${tradition}#t-${tradition}`}
                  style={{ display: 'inline-block', marginTop: 8, fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.link, letterSpacing: 1, textDecoration: 'none', textTransform: 'uppercase' }}
                >
                  {isExpanded ? '← Collapse' : `Show all ${list.length} →`}
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
