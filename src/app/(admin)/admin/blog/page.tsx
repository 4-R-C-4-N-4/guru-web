/**
 * src/app/(admin)/admin/blog/page.tsx
 *
 * The /admin/blog editorial surface (IMPL T7). Three views — Queue, Drafts,
 * Published — selected via ?tab=. Server component: reads come from the
 * admin-blog lib helpers server-side (no client /api/admin read fetches,
 * matching the other admin pages); the seed form and per-row actions are
 * small client islands.
 *
 * Spec: docs/blog-pipeline/BRD-blog-pipeline.md §5.5, IMPL T7.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tokens } from '@/styles/tokens';
import { listPosts, listCorpusCatalog, type BlogPostRow } from '@/lib/admin-blog';
import { MD_COMPONENTS } from '@/lib/markdown';
import { SeedForm } from './seed-form';
import { QueueActions, DraftActions, PublishedActions } from './actions';

export const dynamic = 'force-dynamic';

type Tab = 'queue' | 'drafts' | 'published';

// Which statuses each tab surfaces. Drafts also shows needs_attention so the
// operator sees parked seeds and their error_note in one place.
const TAB_STATUSES: Record<Tab, string[]> = {
  queue: ['queued', 'generating'],
  drafts: ['draft', 'needs_attention'],
  published: ['published'],
};

const TABS: Tab[] = ['queue', 'drafts', 'published'];

function parseTab(v: string | string[] | undefined): Tab {
  return v === 'drafts' || v === 'published' ? v : 'queue';
}

export default async function BlogAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = parseTab(sp.tab);

  // Fetch the rows for every status this tab covers, then sort newest-first.
  const statuses = TAB_STATUSES[tab];
  const groups = await Promise.all(statuses.map(s => listPosts(s)));
  const rows = groups.flat().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // The seed form (only on the queue tab) needs the corpus catalog server-side.
  const catalog = tab === 'queue' ? await listCorpusCatalog() : {};

  return (
    <div>
      <h1 style={{ fontFamily: tokens.font.display, fontSize: 24, color: tokens.text.primary, marginBottom: 16 }}>
        Blog
      </h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, borderBottom: `1px solid ${tokens.border.subtle}` }}>
        {TABS.map(t => (
          <a
            key={t}
            href={`/admin/blog?tab=${t}`}
            style={{
              fontFamily: tokens.font.mono,
              fontSize: 12,
              padding: '6px 2px',
              color: t === tab ? tokens.text.accent : tokens.text.muted,
              borderBottom: t === tab ? `2px solid ${tokens.text.accent}` : '2px solid transparent',
              textDecoration: 'none',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {t}
          </a>
        ))}
      </div>

      {tab === 'queue' && <SeedForm catalog={catalog} />}

      {rows.length === 0 ? (
        <p style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.text.muted }}>
          Nothing in {tab}.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map(row => (
            <PostCard key={row.id} row={row} tab={tab} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PostCard({ row, tab }: { row: BlogPostRow; tab: Tab }) {
  return (
    <li
      style={{
        border: `1px solid ${tokens.border.subtle}`,
        borderRadius: 4,
        padding: 16,
        marginBottom: 16,
        background: tokens.bg.surface,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: tokens.font.display, fontSize: 18, color: tokens.text.primary }}>
            {row.title ?? row.concept_ids.join('  ×  ')}
          </div>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginTop: 4, letterSpacing: 0.5 }}>
            {row.status.toUpperCase()} · {row.model}
            {row.angle ? ` · ${row.angle}` : ''}
            {row.cost_usd ? ` · $${Number(row.cost_usd).toFixed(4)}` : ''}
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {tab === 'queue' && <QueueActions id={row.id} />}
          {tab === 'drafts' && <DraftActions id={row.id} canPublish={row.status === 'draft'} />}
          {tab === 'published' && <PublishedActions id={row.id} />}
        </div>
      </div>

      {/* needs_attention diagnostic */}
      {row.status === 'needs_attention' && row.error_note && (
        <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.error, marginTop: 8 }}>
          ⚠ {row.error_note}
        </div>
      )}

      {/* Draft body preview + sources, for the grounding review */}
      {tab === 'drafts' && row.status === 'draft' && row.content && (
        <div style={{ marginTop: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: 0, fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.primary, lineHeight: 1.7 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {row.content}
            </ReactMarkdown>
          </div>
          <div style={{ flex: '0 0 220px' }}>
            <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>
              Sources used
            </div>
            <ChunksUsed chunks={row.chunks_used} />
          </div>
        </div>
      )}
    </li>
  );
}

function ChunksUsed({ chunks }: { chunks: unknown }) {
  const list = Array.isArray(chunks)
    ? (chunks as Array<{ tradition?: string; text_name?: string; section?: string; tier?: string }>)
    : [];
  if (list.length === 0) {
    return <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted }}>—</div>;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {list.map((c, i) => (
        <li key={i} style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.secondary, marginBottom: 3 }}>
          {c.tradition} · {c.text_name} · {c.section}
        </li>
      ))}
    </ul>
  );
}
