/**
 * src/app/api/admin/queries/[id]/route.ts
 *
 * GET /api/admin/queries/:id — single query deep dive (full payload
 * + raw row JSON). Spec: BRD-admin-ui §1.9.
 */

import { requireAdmin } from '@/lib/admin';
import { getQueryDeepDive } from '@/lib/admin-queries';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const { id } = await ctx.params;
  const data = await getQueryDeepDive(id);
  if (!data) return new Response(null, { status: 404 });

  return Response.json(data);
}
