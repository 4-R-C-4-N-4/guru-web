/**
 * POST /api/admin/blog/atlas — generate a "State of the Atlas" edition draft.
 *
 * The browser equivalent of `npm run atlas`: lets the operator mint an edition
 * from the admin surface (no SSH / env-sourcing on the VPS). Synchronous like
 * the seed Generate route — the LLM call runs inline (~seconds) and the result
 * is a DRAFT to review and publish. Gates on requireAdmin().
 *
 * generateAtlasEdition throws on the expected refusals (an edition already in
 * flight, a corpus with no verified parallels, an empty completion); those map
 * to 409 with the message so the operator sees why. ?force=1 overrides the
 * in-flight dup-guard.
 */

import { requireAdmin } from '@/lib/admin';
import { generateAtlasEdition } from '@/lib/atlas-generate';

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
    return Response.json({ error }, { status: 409 });
  }
}
