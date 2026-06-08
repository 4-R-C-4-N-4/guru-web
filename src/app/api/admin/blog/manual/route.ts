/**
 * POST /api/admin/blog/manual — create a free-form post as a draft.
 *
 * No LLM, no seed, no retrieval: the operator writes title/dek/content and it
 * lands directly in the Drafts tab, to be reviewed/edited and published through
 * the normal flow. Gates on requireAdmin(); 400 on a bad/empty body.
 */

import { requireAdmin } from '@/lib/admin';
import { createManualDraft } from '@/lib/admin-blog';

export async function POST(req: Request) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const b = body as { title?: unknown; dek?: unknown; content?: unknown };
  if (typeof b.title !== 'string' || typeof b.content !== 'string' ||
      (b.dek !== null && b.dek !== undefined && typeof b.dek !== 'string')) {
    return Response.json({ error: 'title and content are required strings' }, { status: 400 });
  }

  const outcome = await createManualDraft({
    title: b.title,
    dek: (b.dek as string | null) ?? null,
    content: b.content,
    created_by: result.email,
  });
  if (!outcome.ok) {
    return Response.json({ error: 'title and content must be non-empty' }, { status: 400 });
  }
  return Response.json(outcome.row, { status: 201 });
}
