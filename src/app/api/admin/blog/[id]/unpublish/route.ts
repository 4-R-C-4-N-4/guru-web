/**
 * POST /api/admin/blog/:id/unpublish — pull a published post back to draft.
 *
 * setStatus(id, 'draft') guards the transition (only published/archived rows)
 * and clears published_at, so the post leaves public view (within the list
 * cache TTL) and reappears in the Drafts tab — editable and re-publishable.
 * Gates on requireAdmin(); 404 on missing, 409 if not unpublishable.
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
  const outcome = await setStatus(id, 'draft');
  if (!outcome.ok) {
    return new Response(null, { status: outcome.reason === 'illegal_transition' ? 409 : 404 });
  }
  return Response.json(outcome.row);
}
