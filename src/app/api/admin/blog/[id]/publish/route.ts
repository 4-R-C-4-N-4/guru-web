/**
 * POST /api/admin/blog/:id/publish — move a draft to published.
 *
 * setStatus stamps published_at = now() on this transition. Gates on
 * requireAdmin(), 404 on failure (IMPL Hard rule 4).
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
  const row = await setStatus(id, 'published');
  if (!row) return new Response(null, { status: 404 });
  return Response.json(row);
}
