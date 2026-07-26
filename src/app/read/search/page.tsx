/**
 * src/app/read/search/page.tsx
 *
 * Corpus search (todo:3c342f3b) — the reader's semantic ctrl-F. Public,
 * server-rendered, zero client JS: a plain GET form; results are chunk
 * cards linking into the reader. Hybrid vector+lexical via lib/search
 * (chat's own retrieval legs), so "passages about dissolving the self"
 * finds Eckhart AND the Tao Te Ching, not just word matches.
 *
 * Cost control on a small VPS: every query costs one local Ollama embed +
 * two corpus scans, so searches are rate-limited per IP (in-memory fixed
 * window — the DB limiter FKs to users and can't key anonymous IPs). When
 * Ollama is down the page degrades to lexical-only and says so.
 *
 * The static `search` segment wins over /read/[tradition] (no tradition is
 * named "search").
 */

import Link from 'next/link';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { searchCorpus, SEARCH_TOP_K } from '@/lib/search';
import { ipRateLimit } from '@/lib/ip-rate-limit';
import { listTraditionsForReader } from '@/lib/reader';
import { chunkIdToPath } from '@/lib/read-path';
import type { RetrievedChunk } from '@/lib/types';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search — Source Library — Guru',
  description:
    'Search the corpus by meaning, not just words — passages from 21 traditions, filtered by tradition, each linking into the reader.',
  alternates: { canonical: '/read/search' },
};

const SEARCH_LIMIT_PER_MIN = 15;
const PREVIEW_LEN = 280;

type Search = Promise<{ q?: string | string[]; tradition?: string | string[]; text?: string | string[] }>;

function first(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  // Caddy fronts prod; first hop of x-forwarded-for is the client.
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

function ResultCard({ c }: { c: RetrievedChunk }) {
  const href = chunkIdToPath(c.id);
  const color = tokens.tradition[c.tradition as keyof typeof tokens.tradition] ?? tokens.text.secondary;
  const card = (
    <div style={{ borderLeft: `2px solid ${color}`, background: `${color}08`, padding: '10px 14px', margin: '10px 0' }}>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ color }}>{c.tradition}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{c.text_name}</span>
        {c.section && (<><span style={{ opacity: 0.4 }}>|</span><span>{c.section}</span></>)}
      </div>
      <div style={{ fontFamily: tokens.font.display, fontSize: 14, color: tokens.text.primary, lineHeight: 1.6 }}>
        {c.body.length > PREVIEW_LEN ? `${c.body.slice(0, PREVIEW_LEN).trimEnd()}…` : c.body}
      </div>
    </div>
  );
  return href
    ? <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>{card}</Link>
    : card;
}

export default async function SearchPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const q = first(sp.q);
  const tradition = first(sp.tradition);
  const text = first(sp.text);

  const traditions = await listTraditionsForReader();

  let results: RetrievedChunk[] | null = null;
  let lexicalOnly = false;
  let limited: number | null = null;

  if (q) {
    const verdict = ipRateLimit(`search:${await clientIp()}`, SEARCH_LIMIT_PER_MIN, 60_000);
    if (!verdict.allowed) {
      limited = verdict.retryAfterSeconds;
    } else {
      const r = await searchCorpus(q, { tradition, text }, SEARCH_TOP_K);
      results = r.chunks;
      lexicalOnly = r.lexicalOnly;
    }
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
          <span style={{ ...crumbStyle, color: tokens.text.muted }}>Search</span>
        </nav>

        <header style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: tokens.font.display, fontSize: 34, fontWeight: 600, color: tokens.text.primary, margin: 0, lineHeight: 1.2 }}>
            Search the corpus
          </h1>
          <p style={{ fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.secondary, lineHeight: 1.7, margin: '10px 0 0', fontStyle: 'italic', maxWidth: 600 }}>
            By meaning, not just words — ask for &ldquo;dissolving the self&rdquo;
            and find it whether a text says annihilation, fana, or letting go.
          </p>
        </header>

        <form method="GET" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 32 }}>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="light within, the nature of the soul, …"
            autoFocus
            style={{
              flex: '1 1 320px', padding: '10px 14px',
              fontFamily: tokens.font.display, fontSize: 16,
              color: tokens.text.primary, background: tokens.bg.surface,
              border: `1px solid ${tokens.border.medium}`, borderRadius: 3, outline: 'none',
            }}
          />
          <select
            name="tradition"
            defaultValue={tradition ?? ''}
            style={{
              padding: '10px 12px', fontFamily: tokens.font.mono, fontSize: 12,
              color: tokens.text.secondary, background: tokens.bg.surface,
              border: `1px solid ${tokens.border.medium}`, borderRadius: 3,
            }}
          >
            <option value="">all traditions</option>
            {traditions.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          {text && <input type="hidden" name="text" value={text} />}
          <button
            type="submit"
            style={{
              padding: '10px 20px', fontFamily: tokens.font.mono, fontSize: 12,
              letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer',
              color: tokens.bg.deep, background: tokens.text.accent,
              border: 'none', borderRadius: 3,
            }}
          >
            Search
          </button>
        </form>

        {limited !== null && (
          <p style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.text.error }}>
            Searching a little fast — try again in {limited}s.
          </p>
        )}

        {results !== null && (
          <section>
            <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
              {results.length === 0 ? 'No passages found' : `${results.length} passages`}
              {tradition && ` · ${tradition}`}
              {text && ` · ${text}`}
            </div>
            {lexicalOnly && (
              <p style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.error, margin: '6px 0 0' }}>
                Semantic search is temporarily unavailable — showing exact-word matches only.
              </p>
            )}
            {results.map(c => <ResultCard key={c.id} c={c} />)}
          </section>
        )}
      </div>
    </main>
  );
}
