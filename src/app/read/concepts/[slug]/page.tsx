/**
 * src/app/read/concepts/[slug]/page.tsx
 *
 * Concept page — every passage in the corpus expressing one concept,
 * grouped by tradition. Linked from the Themes chips on chunk pages. The
 * static `concepts` segment wins over the dynamic /read/[tradition] route
 * (no tradition is named "concepts"). Slug = concept id minus the
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

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const concept = await getConcept(`concept.${slug}`);
  if (!concept) return { title: 'Not found — Guru' };
  return {
    title: `${concept.label} — Source Library — Guru`,
    description: concept.definition ?? `Passages expressing ${concept.label} across the corpus.`,
  };
}

export default async function ConceptPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const conceptId = `concept.${slug}`;
  const [concept, chunks] = await Promise.all([
    getConcept(conceptId),
    listChunksExpressing(conceptId),
  ]);
  if (!concept) notFound();

  // Group by tradition, preserving the tier-then-id order within each group.
  const byTradition = new Map<string, ExpressingChunk[]>();
  for (const c of chunks) {
    const list = byTradition.get(c.tradition) ?? [];
    list.push(c);
    byTradition.set(c.tradition, list);
  }

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

        <header style={{ marginBottom: 36 }}>
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
            {chunks.length.toLocaleString()} passages · {byTradition.size} traditions
          </div>
        </header>

        {[...byTradition.entries()].map(([tradition, list]) => {
          const color = tokens.tradition[tradition as keyof typeof tokens.tradition] ?? tokens.text.secondary;
          return (
            <section key={tradition} style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8, borderBottom: `1px solid ${tokens.border.subtle}`, paddingBottom: 4 }}>
                {tradition} · {list.length}
              </div>
              {list.map(c => {
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
            </section>
          );
        })}
      </div>
    </main>
  );
}
