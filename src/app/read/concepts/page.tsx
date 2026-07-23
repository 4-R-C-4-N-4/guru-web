/**
 * src/app/read/concepts/page.tsx
 *
 * Concept index — the browse entrance to the concept layer (todo:a9e37a38).
 * The 110 constellation pages were only reachable through chunk-page tag
 * chips; this page walks the domain → family → concept hierarchy with live
 * passage counts, each concept linking to its constellation page. Public,
 * server-rendered, mirrors api/hierarchy's primary-family placement; the
 * few concepts without a family group under an Unclassified tail so every
 * concept stays reachable.
 */

import Link from 'next/link';
import type { Metadata } from 'next';
import { listConceptIndex, type ConceptIndexEntry } from '@/lib/reader';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Concepts — Source Library — Guru',
  description:
    'Browse the concept layer of the corpus: every theme the traditions express, organized by domain and family, each linking to its passages across 21 traditions.',
};

const crumbStyle = {
  fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.link,
  letterSpacing: 1, textDecoration: 'none', textTransform: 'uppercase',
} as const;

function ConceptLink({ c }: { c: ConceptIndexEntry }) {
  return (
    <Link
      href={`/read/concepts/${c.id.replace(/^concept\./, '')}`}
      title={c.definition ?? undefined}
      style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 6,
        border: `1px solid ${tokens.border.subtle}`, background: tokens.bg.surface,
        padding: '4px 10px', textDecoration: 'none', borderRadius: 3,
      }}
    >
      <span style={{ fontFamily: tokens.font.display, fontSize: 14, color: tokens.text.primary }}>
        {c.label}
      </span>
      <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted }}>
        {c.passages.toLocaleString()}
      </span>
    </Link>
  );
}

export default async function ConceptIndexPage() {
  const { families, concepts } = await listConceptIndex();

  const domains = families.filter(f => f.parent_id === null);
  const familiesByDomain = new Map<string, typeof families>();
  for (const f of families) {
    if (f.parent_id === null) continue;
    const list = familiesByDomain.get(f.parent_id) ?? [];
    list.push(f);
    familiesByDomain.set(f.parent_id, list);
  }
  const conceptsByFamily = new Map<string, ConceptIndexEntry[]>();
  const unclassified: ConceptIndexEntry[] = [];
  for (const c of concepts) {
    if (!c.family_id) { unclassified.push(c); continue; }
    const list = conceptsByFamily.get(c.family_id) ?? [];
    list.push(c);
    conceptsByFamily.set(c.family_id, list);
  }

  return (
    <main style={{ minHeight: '100vh', background: tokens.bg.deep, padding: '64px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <nav style={{ marginBottom: 24 }}>
          <Link href="/read" style={crumbStyle}>Library</Link>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}> / </span>
          <span style={{ ...crumbStyle, color: tokens.text.muted }}>Concepts</span>
        </nav>

        <header style={{ marginBottom: 40 }}>
          <h1 style={{ fontFamily: tokens.font.display, fontSize: 34, fontWeight: 600, color: tokens.text.primary, margin: 0, lineHeight: 1.2 }}>
            Concepts
          </h1>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 1, marginTop: 8 }}>
            {concepts.length} concepts · {domains.length} domains
          </div>
          <p style={{ fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.secondary, lineHeight: 1.7, margin: '12px 0 0', fontStyle: 'italic', maxWidth: 600 }}>
            Every theme the corpus expresses, organized by domain and family.
            Each concept opens its constellation — where it appears across the
            traditions, passage by passage.
          </p>
        </header>

        {domains.map(d => (
          <section key={d.id} style={{ marginBottom: 40 }}>
            <h2 style={{ fontFamily: tokens.font.display, fontSize: 24, fontWeight: 600, color: tokens.text.accent, margin: '0 0 4px' }}>
              {d.label}
            </h2>
            {d.definition && (
              <p style={{ fontFamily: tokens.font.display, fontSize: 14, color: tokens.text.secondary, fontStyle: 'italic', lineHeight: 1.6, margin: '0 0 14px' }}>
                {d.definition}
              </p>
            )}
            {(familiesByDomain.get(d.id) ?? []).map(f => {
              const list = conceptsByFamily.get(f.id) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={f.id} style={{ marginBottom: 18, paddingLeft: 14, borderLeft: `1px solid ${tokens.border.subtle}` }}>
                  <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>
                    {f.label}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {list.map(c => <ConceptLink key={c.id} c={c} />)}
                  </div>
                </div>
              );
            })}
          </section>
        ))}

        {unclassified.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>
              Unclassified
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {unclassified.map(c => <ConceptLink key={c.id} c={c} />)}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
