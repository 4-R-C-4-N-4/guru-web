/**
 * src/app/(admin)/admin/queries/[id]/page.tsx
 *
 * Single-query deep dive. Same payload as a single expanded
 * <ExpandableQuery> on the session view, plus the raw-JSON nested
 * <details> open by default.
 *
 * Spec: BRD-admin-ui §1.9, BRD-admin-ui-design §4.5.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tokens } from '@/styles/tokens';
import { getQueryDeepDive } from '@/lib/admin-queries';
import { ExpandableQuery } from '@/components/admin/ExpandableQuery';

export const dynamic = 'force-dynamic';

export default async function QueryDeepDive({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getQueryDeepDive(id);
  if (!data) notFound();

  const q = data.query;

  return (
    <>
      <div style={{ marginBottom: 16, fontSize: 12, color: tokens.text.muted }}>
        <Link href={`/admin/users/${q.user_id}`} style={crumb}>{q.user_email}</Link>
        {' / '}
        <Link href={`/admin/sessions/${q.session_id}`} style={crumb}>Session {q.session_id.slice(0, 8)}</Link>
        {' / '}
        <span style={{ color: tokens.text.primary }}>Query {q.id.slice(0, 8)}</span>
      </div>

      <h1 style={{ fontSize: 18, color: tokens.text.primary, marginBottom: 8 }}>Query</h1>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted, marginBottom: 24 }}>
        {q.id}
      </div>

      <ExpandableQuery
        query={q}
        defaultOpen
        rawOpenByDefault
        raw={data.raw}
      />
    </>
  );
}

const crumb: React.CSSProperties = { color: tokens.text.link, textDecoration: 'none' };
