/**
 * POST /api/admin/blog/:id/reject — mark a post rejected.
 *
 * Gates on requireAdmin(), 404 on failure (IMPL Hard rule 4).
 *
 * Spec: docs/blog-pipeline/BRD-blog-pipeline.md §4, IMPL T4.
 */

import { requireAdmin } from '@/lib/admin';
import { setStatus } from '@/lib/admin-blog';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const { id } = await ctx.params;
  const outcome = await setStatus(id, 'rejected');
  if (!outcome.ok) {
    return new Response(null, { status: outcome.reason === 'illegal_transition' ? 409 : 404 });
  }
  return Response.json(outcome.row);
}
