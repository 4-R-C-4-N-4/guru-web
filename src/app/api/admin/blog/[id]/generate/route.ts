/**
 * POST /api/admin/blog/:id/generate — generate a draft from a queued seed.
 *
 * Runs generateDraft SYNCHRONOUSLY (BRD §6): admin-only, low volume, so
 * holding the request open until the draft is ready is fine. Returns the
 * resulting row (a 'draft' on success, 'needs_attention' on a thin
 * retrieval or error).
 *
 * Spec: docs/blog-pipeline/BRD-blog-pipeline.md §6, IMPL T4.
 */

import { requireAdmin } from '@/lib/admin';
import { generateDraft } from '@/lib/blog-generate';
import { getPost } from '@/lib/admin-blog';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const { id } = await ctx.params;
  await generateDraft(id);

  const row = await getPost(id);
  if (!row) return new Response(null, { status: 404 });
  return Response.json(row);
}
