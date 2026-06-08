/**
 * POST /api/admin/blog/atlas — generate a "State of the Atlas" edition draft.
 *
 * The browser equivalent of `npm run atlas`: lets the operator mint an edition
 * from the admin surface (no SSH / env-sourcing on the VPS). Synchronous like
 * the seed Generate route — the LLM call runs inline (~seconds) and the result
 * is a DRAFT to review and publish. Gates on requireAdmin().
 *
 * Operator-actionable refusals (an edition already in flight, a corpus with no
 * verified parallels) throw AtlasRefusal → 409 with the message. Unexpected or
 * transient failures (LLM/network error, empty completion) → 500. ?force=1
 * overrides the in-flight dup-guard.
 */

import { requireAdmin } from '@/lib/admin';
import { generateAtlasEdition, AtlasRefusal } from '@/lib/atlas-generate';

export async function POST(req: Request) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const force = new URL(req.url).searchParams.get('force') === '1';
  try {
    const edition = await generateAtlasEdition({
      generatedAt: new Date().toISOString(),
      force,
    });
    return Response.json({
      id: edition.id,
      slug: edition.slug,
      editionNo: edition.editionNo,
      title: edition.title,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'generation failed';
    // Refusals the operator can act on → 409; unexpected/transient → 500.
    return Response.json({ error }, { status: err instanceof AtlasRefusal ? 409 : 500 });
  }
}
