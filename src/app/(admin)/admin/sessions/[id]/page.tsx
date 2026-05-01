/**
 * src/app/(admin)/admin/sessions/[id]/page.tsx
 *
 * Session deep dive. Header strip with breadcrumb (link to user, link
 * to all sessions for that user) + stat tiles. Body: list of
 * <ExpandableQuery>, collapsed by default. Expand-all / Collapse-all
 * via fragment links.
 *
 * Spec: BRD-admin-ui §1.8, BRD-admin-ui-design §4.4.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tokens } from '@/styles/tokens';
import { getSessionDeepDive } from '@/lib/admin-queries';
import { StatTile } from '@/components/admin/StatTile';
import { ExpandableQuery } from '@/components/admin/ExpandableQuery';

export const dynamic = 'force-dynamic';

export default async function SessionDeepDive({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const expandAll = sp.expand === 'all';

  const data = await getSessionDeepDive(id);
  if (!data) notFound();

  const { session, totals, queries } = data;
  const durationMs = new Date(session.updated_at).getTime() - new Date(session.created_at).getTime();
  const durationLabel = humanDuration(durationMs);

  return (
    <>
      <div style={{ marginBottom: 16, fontSize: 12, color: tokens.text.muted }}>
        <Link href={`/admin/users/${session.user_id}`} style={crumb}>{session.user_email}</Link>
        {' / '}
        <span style={{ color: tokens.text.primary }}>Session {session.id.slice(0, 8)}</span>
      </div>

      <h1 style={{ fontSize: 18, color: tokens.text.primary, marginBottom: 8 }}>
        {session.title ?? <span style={{ color: tokens.text.muted }}>Untitled</span>}
      </h1>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted, marginBottom: 16 }}>
        {session.id}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        <StatTile label="Queries" value={String(totals.query_count)} delta={null} />
        <StatTile label="Spend" value={`$${totals.spend.toFixed(6)}`} delta={null} />
        <StatTile label="Tokens in"  value={Intl.NumberFormat().format(totals.input_tokens)}  delta={null} />
        <StatTile label="Tokens out" value={Intl.NumberFormat().format(totals.output_tokens)} delta={null} />
        <StatTile label="Tokens cached" value={Intl.NumberFormat().format(totals.cached_input_tokens)} delta={null} />
        <StatTile label="Duration" value={durationLabel} delta={null} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h2 style={sectionH}>Queries</h2>
        <div style={{ fontSize: 11 }}>
          <Link href={`/admin/sessions/${session.id}?expand=all`} style={tinyLink}>expand all</Link>
          {' · '}
          <Link href={`/admin/sessions/${session.id}`}            style={tinyLink}>collapse all</Link>
          {' · '}
          <a href={`/api/admin/sessions/${session.id}/queries.csv`} style={tinyLink}>CSV</a>
        </div>
      </div>

      {queries.length === 0 ? (
        <div style={{ color: tokens.text.muted, fontSize: 12 }}>No queries in this session.</div>
      ) : (
        queries.map((q) => (
          <ExpandableQuery
            key={q.id}
            query={q}
            anchorId={`q-${q.id}`}
            defaultOpen={expandAll}
          />
        ))
      )}
    </>
  );
}

const crumb: React.CSSProperties = { color: tokens.text.link, textDecoration: 'none' };
const tinyLink: React.CSSProperties = { color: tokens.text.link, textDecoration: 'none' };
const sectionH: React.CSSProperties = {
  fontSize: 12, color: tokens.text.muted,
  textTransform: 'uppercase', letterSpacing: 0.5,
};

function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60)        return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)        return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)        return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
