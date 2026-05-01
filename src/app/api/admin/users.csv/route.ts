/**
 * src/app/api/admin/users.csv/route.ts
 *
 * GET /api/admin/users.csv — streaming CSV export of the users list,
 * honouring the same filter / sort URL params as
 * /api/admin/users.
 *
 * Streaming strategy: paginate by 1000-row chunks via listUsers().
 * Each chunk is one ReadableStream chunk; row materialisation never
 * exceeds one batch in memory. At our scale this never trips, but
 * the streaming shape leaves room to swap in pg-cursor without
 * changing the helper's contract.
 *
 * Spec: BRD-admin-ui §1.18.
 */

import { requireAdmin } from '@/lib/admin';
import { listUsers, type UserListFilters, type UserListSort } from '@/lib/admin-queries';
import { streamingCsv, type CsvCell } from '@/components/admin/csv';
import { parseUserListSearchParams } from '../user-params';

const BATCH_SIZE = 1000;

const HEADER = [
  'user_id', 'email', 'tier', 'stripe_customer_id',
  'created_at', 'last_query_at', 'queries_7d', 'spend_7d',
];

export async function GET(req: Request) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const url = new URL(req.url);
  const { filters, sort } = parseUserListSearchParams(url.searchParams);

  return streamingCsv(
    `users-${new Date().toISOString().slice(0, 10)}.csv`,
    HEADER,
    batches(filters, sort),
  );
}

async function* batches(filters: UserListFilters, sort: UserListSort): AsyncIterable<CsvCell[][]> {
  let page = 0;
  for (;;) {
    const rows = await listUsers(filters, sort, page, BATCH_SIZE);
    if (rows.length === 0) return;

    yield rows.map((r) => [
      r.id,
      r.email,
      r.tier,
      r.stripe_customer_id ?? '',
      r.created_at,
      r.last_query_at ?? '',
      r.queries_7d,
      r.spend_7d.toFixed(6),
    ] satisfies CsvCell[]);

    if (rows.length < BATCH_SIZE) return;
    page++;
  }
}
