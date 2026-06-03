/**
 * POST /api/admin/blog/:id/publish — move a draft to published.
 *
 * setStatus stamps published_at = now() and guards the transition: only a
 * generated `draft` with content can be published, so an ungenerated/empty row
 * can't go live (that would 500 the public list paths). Gates on requireAdmin(),
 * 404 on missing, 409 on illegal transition (IMPL Hard rule 4).
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
  const outcome = await setStatus(id, 'published');
  if (!outcome.ok) {
    return new Response(null, { status: outcome.reason === 'illegal_transition' ? 409 : 404 });
  }
  return Response.json(outcome.row);
}
