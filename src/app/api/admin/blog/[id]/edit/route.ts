/**
 * PUT /api/admin/blog/:id/edit — manually edit a draft before publishing.
 *
 * Lets the operator surgically fix LLM output (title/dek/content) prior to
 * going live. updateDraft guards the transition (only draft/needs_attention are
 * editable) and promotes a salvaged needs_attention row to draft. Gates on
 * requireAdmin(); 400 on bad/empty body, 404 on missing, 409 if not editable.
 */

import { requireAdmin } from '@/lib/admin';
import { updateDraft } from '@/lib/admin-blog';

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const b = body as { title?: unknown; dek?: unknown; content?: unknown };
  if (typeof b.title !== 'string' || typeof b.content !== 'string' ||
      (b.dek !== null && b.dek !== undefined && typeof b.dek !== 'string')) {
    return new Response(null, { status: 400 });
  }

  const outcome = await updateDraft(id, {
    title: b.title,
    dek: (b.dek as string | null) ?? null,
    content: b.content,
  });
  if (!outcome.ok) {
    const status = outcome.reason === 'not_found' ? 404 : outcome.reason === 'empty' ? 400 : 409;
    return new Response(null, { status });
  }
  return Response.json(outcome.row);
}
