/**
 * src/app/(admin)/admin/users/page.tsx
 *
 * Users list view. Filters / sort / pagination are URL-driven.
 *
 * Spec: BRD-admin-ui §1.6, BRD-admin-ui-design §4.2.
 */

import { tokens } from '@/styles/tokens';
import { listUsers, countUsers } from '@/lib/admin-queries';
import { parseUserListSearchParams, PAGE_SIZE } from '@/app/api/admin/user-params';
import { DataTable, type Column } from '@/components/admin/DataTable';
import { FilterPills } from '@/components/admin/FilterPills';
import { StatTile } from '@/components/admin/StatTile';

export const dynamic = 'force-dynamic';

interface UserRow {
  id: string; email: string; tier: 'free' | 'pro';
  stripe_customer_id: string | null;
  currency: string;
  created_at: string;
  last_query_at: string | null;
  queries_7d: number;
  spend_7d: number;
}

export default async function UsersList({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = new URLSearchParams();
  const raw = await searchParams;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') sp.set(k, v);
  }
  const { filters, sort, page } = parseUserListSearchParams(sp);

  const [rows, total] = await Promise.all([
    listUsers(filters, sort, page, PAGE_SIZE),
    countUsers(filters),
  ]);

  // URL helpers — these own the param shape so DataTable stays generic.
  const baseParams = new URLSearchParams(sp);
  const sortHref = (col: string, dir: 'asc' | 'desc') => {
    const next = new URLSearchParams(baseParams);
    next.set('sort', col);
    next.set('dir',  dir);
    next.delete('page');
    return `/admin/users?${next.toString()}`;
  };
  const pageHref = (p: number) => {
    const next = new URLSearchParams(baseParams);
    if (p === 0) next.delete('page'); else next.set('page', String(p));
    return `/admin/users?${next.toString()}`;
  };
  const csvHref = (() => {
    const next = new URLSearchParams(baseParams);
    next.delete('page');
    return `/api/admin/users.csv?${next.toString()}`;
  })();

  const columns: Column<UserRow>[] = [
    { key: 'email', label: 'Email', sortable: true,
      render: (u) => u.email },
    { key: 'tier', label: 'Tier', sortable: false,
      render: (u) => <TierBadge tier={u.tier} /> },
    { key: 'created_at', label: 'Created', sortable: true,
      render: (u) => fmtDate(u.created_at) },
    { key: 'last_query_at', label: 'Last query', sortable: true,
      render: (u) => u.last_query_at ? fmtDate(u.last_query_at) : <span style={{ color: tokens.text.muted }}>—</span> },
    { key: 'queries_7d', label: 'Queries (7d)', sortable: true, align: 'right',
      render: (u) => u.queries_7d },
    { key: 'spend_7d', label: 'Spend (7d)', sortable: true, align: 'right',
      render: (u) => `$${u.spend_7d.toFixed(4)}` },
    { key: 'stripe', label: 'Stripe', sortable: false, align: 'right',
      render: (u) => u.stripe_customer_id
        ? <a href={`https://dashboard.stripe.com/customers/${u.stripe_customer_id}`}
             target="_blank" rel="noreferrer"
             style={{ color: tokens.text.link, textDecoration: 'none', fontFamily: tokens.font.mono, fontSize: 11 }}>↗</a>
        : <span style={{ color: tokens.text.muted }}>—</span> },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, color: tokens.text.primary }}>Users</h1>
        <StatTile label="Total" value={String(total)} delta={null} />
      </div>

      <FilterPills
        pills={[
          { param: 'tier', label: 'tier', defaultValue: 'all',
            options: [{ value: 'all', label: 'all' }, { value: 'free', label: 'free' }, { value: 'pro', label: 'pro' }] },
          { param: 'created', label: 'created', defaultValue: 'all',
            options: [{ value: 'all', label: 'all' }, { value: 'today', label: 'today' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }] },
          { param: 'queried', label: 'queried', defaultValue: 'all',
            options: [{ value: 'all', label: 'all' }, { value: 'today', label: 'today' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }, { value: 'never', label: 'never' }] },
        ]}
        searchParam="q"
        searchPlaceholder="search email…"
      />

      <DataTable<UserRow>
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        rowHref={(u) => `/admin/users/${u.id}`}
        emptyMessage="No users match these filters."
        sort={{ by: sort.by, dir: sort.dir }}
        sortHref={sortHref}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        pageHref={pageHref}
        csvHref={csvHref}
      />
    </>
  );
}

function TierBadge({ tier }: { tier: 'free' | 'pro' }) {
  const color = tier === 'pro' ? tokens.tier.verified : tokens.text.muted;
  return (
    <span style={{
      fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
      color, border: `1px solid ${color}`, padding: '1px 4px',
    }}>{tier}</span>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}
