/**
 * src/app/api/admin/users/route.ts
 *
 * GET /api/admin/users — paginated, filterable users list. Returns:
 *
 *   {
 *     rows:     UserListRow[],
 *     total:    number,
 *     page:     number,
 *     pageSize: number,
 *   }
 *
 * Filter / sort / page params share names with the page URL so the
 * page can either fetch this endpoint client-side or just pass its
 * own searchParams through to the helper.
 *
 * Spec: BRD-admin-ui §1.6.
 */

import { requireAdmin } from '@/lib/admin';
import { listUsers, countUsers, type UserListSort, type UserListFilters } from '@/lib/admin-queries';
import { parseUserListSearchParams, PAGE_SIZE } from '../user-params';

export async function GET(req: Request) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const url = new URL(req.url);
  const { filters, sort, page } = parseUserListSearchParams(url.searchParams);

  const [rows, total] = await Promise.all([
    listUsers(filters as UserListFilters, sort as UserListSort, page, PAGE_SIZE),
    countUsers(filters as UserListFilters),
  ]);

  return Response.json({ rows, total, page, pageSize: PAGE_SIZE });
}
