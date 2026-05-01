/**
 * src/app/api/admin/sessions/[id]/route.ts
 *
 * GET /api/admin/sessions/:id — full session deep dive payload.
 * Spec: BRD-admin-ui §1.8.
 */

import { requireAdmin } from '@/lib/admin';
import { getSessionDeepDive } from '@/lib/admin-queries';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const { id } = await ctx.params;
  const data = await getSessionDeepDive(id);
  if (!data) return new Response(null, { status: 404 });

  return Response.json(data);
}
