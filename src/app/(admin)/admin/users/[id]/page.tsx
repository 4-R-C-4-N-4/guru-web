/**
 * src/app/(admin)/admin/users/[id]/page.tsx
 *
 * User deep dive. Header strip with stat tiles + dual-axis budget
 * bars; body with sessions table, preferences snapshot, recent
 * rate-limit hits.
 *
 * Spec: BRD-admin-ui §1.7, BRD-admin-ui-design §4.3.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tokens } from '@/styles/tokens';
import { getUserDeepDive, listUserSessions } from '@/lib/admin-queries';
import { StatTile } from '@/components/admin/StatTile';
import { BudgetBar } from '@/components/admin/BudgetBar';
import { DataTable, type Column } from '@/components/admin/DataTable';

export const dynamic = 'force-dynamic';

type SessionRow = Awaited<ReturnType<typeof listUserSessions>>[number];

export default async function UserDeepDive({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [deep, sessions] = await Promise.all([
    getUserDeepDive(id),
    listUserSessions(id),
  ]);
  if (!deep) notFound();

  const u = deep.user;
  const accountAgeDays = Math.floor(
    (Date.now() - new Date(u.created_at).getTime()) / 86_400_000,
  );
  const daily = deep.budgets.find((b) => b.period === 'daily');

  const sessionColumns: Column<SessionRow>[] = [
    { key: 'title', label: 'Title', sortable: false,
      render: (s) => s.title ?? <span style={{ color: tokens.text.muted }}>Untitled</span> },
    { key: 'created_at', label: 'Created', sortable: false,
      render: (s) => new Date(s.created_at).toISOString().slice(0, 16).replace('T', ' ') },
    { key: 'updated_at', label: 'Last activity', sortable: false,
      render: (s) => new Date(s.updated_at).toISOString().slice(0, 16).replace('T', ' ') },
    { key: 'query_count', label: 'Queries', sortable: false, align: 'right',
      render: (s) => s.query_count },
    { key: 'spend', label: 'Spend', sortable: false, align: 'right',
      render: (s) => `$${s.spend.toFixed(4)}` },
  ];

  return (
    <>
      {/* Breadcrumb header */}
      <div style={{ marginBottom: 16, fontSize: 12, color: tokens.text.muted }}>
        <Link href="/admin/users" style={{ color: tokens.text.link, textDecoration: 'none' }}>Users</Link>
        {' / '}
        <span style={{ color: tokens.text.primary }}>{u.email}</span>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted, marginBottom: 8 }}>
          {u.id}
          {u.stripe_customer_id ? (
            <a
              href={`https://dashboard.stripe.com/customers/${u.stripe_customer_id}`}
              target="_blank" rel="noreferrer"
              style={{ marginLeft: 12, color: tokens.text.link }}
            >
              stripe ↗
            </a>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <StatTile label="Tier" value={u.tier} delta={null} />
          <StatTile label="Account age" value={`${accountAgeDays}d`} delta={null} />
          <StatTile label="Queries (lifetime)" value={String(deep.lifetime.queries)} delta={null} />
          <StatTile label="Spend (lifetime)" value={`$${deep.lifetime.spend.toFixed(4)}`} delta={null} />
          <StatTile label="Tokens in"  value={Intl.NumberFormat().format(deep.lifetime.input_tokens)}  delta={null} />
          <StatTile label="Tokens out" value={Intl.NumberFormat().format(deep.lifetime.output_tokens)} delta={null} />
        </div>

        {daily ? (
          <div style={{ maxWidth: 360 }}>
            <BudgetBar
              label="Daily queries"
              used={daily.queries_used}
              limit={daily.query_limit}
            />
            <BudgetBar
              label="Daily spend"
              used={daily.usd_used}
              limit={daily.usd_limit}
              format={(n) => `$${n.toFixed(4)}`}
            />
          </div>
        ) : (
          <div style={{ color: tokens.text.muted, fontSize: 12 }}>No active daily budget row.</div>
        )}
      </div>

      <Section title="Sessions">
        <DataTable<SessionRow>
          columns={sessionColumns}
          rows={sessions}
          rowKey={(s) => s.id}
          rowHref={(s) => `/admin/sessions/${s.id}`}
          emptyMessage="No sessions yet."
          sort={{ by: null, dir: 'desc' }}
          sortHref={() => '#'}
          csvHref={`/api/admin/users/${u.id}/sessions.csv`}
        />
      </Section>

      <Section title="Preferences">
        {deep.preferences ? (
          <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.primary, lineHeight: 1.6 }}>
            <div>scope_mode: {deep.preferences.scope_mode}</div>
            <div>blocked_traditions: {deep.preferences.blocked_traditions.join(', ') || '∅'}</div>
            <div>blocked_texts: {deep.preferences.blocked_texts.join(', ') || '∅'}</div>
            <div>whitelisted_traditions: {deep.preferences.whitelisted_traditions.join(', ') || '∅'}</div>
            <div>whitelisted_texts: {deep.preferences.whitelisted_texts.join(', ') || '∅'}</div>
            <div style={{ color: tokens.text.muted, marginTop: 4 }}>
              updated {new Date(deep.preferences.updated_at).toISOString()}
            </div>
          </div>
        ) : (
          <div style={{ color: tokens.text.muted, fontSize: 12 }}>No preferences saved.</div>
        )}
      </Section>

      <Section title="Recent rate-limit hits (24h)">
        {deep.rate_limits.length === 0 ? (
          <div style={{ color: tokens.text.muted, fontSize: 12 }}>No rate-limit hits in last 24h.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: tokens.font.mono }}>
            <tbody>
              {deep.rate_limits.map((r, i) => (
                <tr key={`${r.scope}-${i}`}>
                  <td style={{ padding: '4px 8px', color: tokens.text.primary }}>{r.scope}</td>
                  <td style={{ padding: '4px 8px', color: tokens.text.muted }}>{new Date(r.last_at).toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{
        fontSize: 12, color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: 0.5,
        marginBottom: 8,
      }}>{title}</h2>
      {children}
    </section>
  );
}
