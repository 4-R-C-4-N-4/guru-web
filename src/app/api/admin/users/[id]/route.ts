/**
 * src/app/api/admin/users/[id]/route.ts
 *
 * GET /api/admin/users/:id — full deep-dive payload for one user:
 * profile, lifetime aggregates, daily/monthly budgets (both axes),
 * preferences snapshot, recent rate-limit hits, sessions list.
 *
 * Spec: BRD-admin-ui §1.7.
 */

import { requireAdmin } from '@/lib/admin';
import { getUserDeepDive, listUserSessions } from '@/lib/admin-queries';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const { id } = await ctx.params;
  const [deep, sessions] = await Promise.all([
    getUserDeepDive(id),
    listUserSessions(id),
  ]);

  if (!deep) return new Response(null, { status: 404 });

  return Response.json({ ...deep, sessions });
}
