/**
 * src/app/(admin)/admin/page.tsx
 *
 * Overview dashboard. Single column, four sections:
 *   1. Stat tile row.
 *   2. Two TabularSparkline blocks side-by-side (queries/day, spend/day).
 *   3. Top users this week DataTable (ticket 5 lands DataTable;
 *      for now this section uses an inline native <table> with the
 *      same structure).
 *   4. Top sessions this week.
 *
 * Spec: BRD-admin-ui §1.5, BRD-admin-ui-design §4.1.
 *
 * Server component — fetches directly via the admin-queries helpers
 * rather than going through /api/admin/overview. The HTTP endpoint
 * exists for future client-side refreshes / other consumers; the
 * page renders synchronously on the server with the same data.
 */

import { tokens } from '@/styles/tokens';
import { StatTile } from '@/components/admin/StatTile';
import { TabularSparkline } from '@/components/admin/TabularSparkline';
import {
  fetchOverviewStats,
  fetchDailySeries,
  fetchTopUsers,
  fetchTopSessions,
  type TopUserRow,
  type TopSessionRow,
  type OverviewStats,
} from '@/lib/admin-queries';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const [stats, queriesPerDay, spendPerDay, topUsers, topSessions] = await Promise.all([
    fetchOverviewStats(),
    fetchDailySeries('count'),
    fetchDailySeries('spend'),
    fetchTopUsers(),
    fetchTopSessions(),
  ]);

  const usd = (n: number) => `$${n.toFixed(2)}`;
  const num = (n: number) => Intl.NumberFormat().format(n);

  return (
    <>
      <h1 style={{ fontSize: 18, marginBottom: 24, color: tokens.text.primary }}>Overview</h1>

      {/* 1. Stat tiles */}
      <Section>
        <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: 16 }}>
          <StatTile label="MTD Spend"        value={usd(stats.spend_mtd_total)}     delta={mtdProjection(stats)} />
          <StatTile label="Users at Budget Risk" value={num(stats.users_at_budget_risk)} delta={null} />
          <StatTile label="Active Rate Limits" value={num(stats.active_rate_limits)}  delta={null} />
          <StatTile label="Queries Today"     value={num(stats.queries_today)}        delta={null} />
          <StatTile label="Spend Today"       value={usd(stats.spend_today_pro + stats.spend_today_free)} delta={tierSplit(stats.spend_today_pro, stats.spend_today_free)} />
          <StatTile label="Active Users (7d)" value={num(stats.users_active_7d)}      delta={null} />
          <StatTile label="Pro / Free"        value={`${num(stats.pro_count)} / ${num(stats.free_count)}`} delta={null} />
          <StatTile label="Total Users"       value={num(stats.users_total)}          delta={{ text: `+${num(stats.users_new_30d)} in 30d`, positive: null }} />
        </div>
      </Section>

      {/* 2. Sparklines side-by-side */}
      <Section>
        <div style={{ display: 'flex', gap: 32 }}>
          <TabularSparkline title="Queries / day (30d)" points={queriesPerDay} format="count" />
          <TabularSparkline title="Spend / day (30d)"  points={spendPerDay}   format="usd" />
        </div>
      </Section>

      {/* 3. Top users this week */}
      <Section>
        <h2 style={SectionH}>Top users this week</h2>
        <TopUsersTable rows={topUsers} />
      </Section>

      {/* 4. Top sessions this week */}
      <Section>
        <h2 style={SectionH}>Top sessions this week</h2>
        <TopSessionsTable rows={topSessions} />
      </Section>
    </>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function mtdProjection(stats: OverviewStats) {
  if (stats.spend_mtd_total === 0) return null;
  const projected = stats.spend_mtd_projection;
  return {
    text:     `proj. $${projected.toFixed(2)} EOM`,
    positive: null,
  };
}

function tierSplit(pro: number, free: number) {
  if (pro + free === 0) return null;
  return {
    text:     `pro $${pro.toFixed(2)} · free $${free.toFixed(2)}`,
    positive: null,
  };
}

const SectionH = {
  fontSize: 12,
  color: tokens.text.muted,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginBottom: 8,
};

function Section({ children }: { children: React.ReactNode }) {
  return <section style={{ marginBottom: 32 }}>{children}</section>;
}

// ── inline tables (replaced by <DataTable> in ticket 5) ──────────────

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: `1px solid ${tokens.border.subtle}`,
  color: tokens.text.muted,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontSize: 11,
};
const td: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: `1px solid ${tokens.border.subtle}`,
  fontVariantNumeric: 'tabular-nums',
};

function TopUsersTable({ rows }: { rows: TopUserRow[] }) {
  if (rows.length === 0) {
    return <div style={{ color: tokens.text.muted, fontSize: 12 }}>No spend this week.</div>;
  }
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>Email</th>
          <th style={{ ...th, textAlign: 'right' }}>Queries</th>
          <th style={{ ...th, textAlign: 'right' }}>Spend (this wk)</th>
          <th style={{ ...th, textAlign: 'right' }}>Trend vs prior wk</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.user_id}>
            <td style={td}>
              <Link href={`/admin/users/${r.user_id}`} style={{ color: tokens.text.link, textDecoration: 'none' }}>
                {r.email}
              </Link>
            </td>
            <td style={{ ...td, textAlign: 'right' }}>{r.queries_this_week}</td>
            <td style={{ ...td, textAlign: 'right' }}>${r.spend_this_week.toFixed(4)}</td>
            <td style={{ ...td, textAlign: 'right' }}>{trend(r.spend_this_week, r.spend_prior_week)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TopSessionsTable({ rows }: { rows: TopSessionRow[] }) {
  if (rows.length === 0) {
    return <div style={{ color: tokens.text.muted, fontSize: 12 }}>No session activity this week.</div>;
  }
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>Title</th>
          <th style={th}>User</th>
          <th style={{ ...th, textAlign: 'right' }}>Queries</th>
          <th style={{ ...th, textAlign: 'right' }}>Spend (this wk)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.session_id}>
            <td style={td}>
              <Link href={`/admin/sessions/${r.session_id}`} style={{ color: tokens.text.link, textDecoration: 'none' }}>
                {r.title ?? <span style={{ color: tokens.text.muted }}>Untitled</span>}
              </Link>
            </td>
            <td style={{ ...td, fontFamily: tokens.font.mono, fontSize: 11 }}>{r.user_email}</td>
            <td style={{ ...td, textAlign: 'right' }}>{r.query_count}</td>
            <td style={{ ...td, textAlign: 'right' }}>${r.spend_this_week.toFixed(4)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function trend(now: number, prev: number): React.ReactNode {
  if (prev === 0 && now === 0) return <span style={{ color: tokens.text.muted }}>—</span>;
  if (prev === 0)              return <span style={{ color: '#7aa37a' }}>new</span>;
  const pct = ((now - prev) / prev) * 100;
  const color = pct >= 0 ? '#7aa37a' : '#a37a7a';
  const arrow = pct >= 0 ? '▲' : '▼';
  return <span style={{ color }}>{arrow} {Math.abs(pct).toFixed(0)}%</span>;
}
