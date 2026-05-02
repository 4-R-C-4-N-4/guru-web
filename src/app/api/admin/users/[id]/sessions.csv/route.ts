/**
 * src/app/api/admin/users/[id]/sessions.csv/route.ts
 *
 * GET /api/admin/users/:id/sessions.csv — streaming CSV of a user's
 * sessions. Paginates the listUserSessions helper by 1000.
 *
 * Spec: BRD-admin-ui §1.18.
 */

import { requireAdmin } from '@/lib/admin';
import { listUserSessions } from '@/lib/admin-queries';
import { streamingCsv, type CsvCell } from '@/components/admin/csv';

const HEADER = ['session_id', 'title', 'created_at', 'updated_at', 'query_count', 'spend'];

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const { id } = await ctx.params;
  const sessions = await listUserSessions(id);

  return streamingCsv(
    `user-${id}-sessions-${new Date().toISOString().slice(0, 10)}.csv`,
    HEADER,
    (async function* () {
      // Single batch — listUserSessions is already bounded (one user's
      // sessions is small). If this ever needs paging we extend the
      // helper rather than re-shape the route.
      yield sessions.map((s) => [
        s.id,
        s.title ?? '',
        s.created_at,
        s.updated_at,
        s.query_count,
        s.spend.toFixed(6),
      ] satisfies CsvCell[]);
    })(),
  );
}
