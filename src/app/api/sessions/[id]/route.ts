/**
 * src/app/api/sessions/[id]/route.ts
 *
 * GET /api/sessions/[id] — get a session with its messages (queries),
 * including citation data rehydrated from corpus.chunks for each
 * message's chunks_used array (todo:89af833a).
 *
 * Tier limitation: queries.chunks_used persists chunk IDs only — not
 * the tier the chunk had in the original retrieval. We default to
 * 'verified' for resumed citations. When the live /api/query path
 * starts persisting tier alongside chunk_id, this default goes away.
 */

import { requireUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { getDossierForText } from '@/lib/dossier';
import { rehydrateCitations } from '@/lib/corpus';
import type { Citation, QueryRecord, Session } from '@/lib/types';

interface MessageWithCitations extends QueryRecord {
  citations: Citation[];
  // Attribution columns surfaced for the chat-view per-response line
  // (model-selection BRD §7.4). Streaming queries populate these after
  // finalizeBudget; historical rows may have nulls for older queries
  // that pre-date the cost-tracking migration.
  input_tokens:  number | null;
  output_tokens: number | null;
  cost_usd:      number | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const { id } = await params;

  const session = await one<Session>(
    `SELECT id, title, mode, study_text_id, created_at, updated_at
     FROM sessions
     WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );

  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  // The dossier TOC depends only on the session row, so it overlaps the
  // records fetch instead of adding a round-trip after it.
  const [records, dossier] = await Promise.all([
    query<QueryRecord & {
      input_tokens:  number | null;
      output_tokens: number | null;
      cost_usd:      string | number | null;
    }>(
      `SELECT id, query_text, response_text, chunks_used, model_used,
              input_tokens, output_tokens, cost_usd, created_at
       FROM queries
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [id]
    ),
    session.mode === 'study' && session.study_text_id
      ? getDossierForText(session.study_text_id)
      : Promise.resolve(null),
  ]);

  // Single batched JOIN against corpus.chunks to rehydrate citations.
  // Collect unique chunk IDs across the whole session so we never run
  // more than one chunks-lookup query, even for long sessions.
  const allChunkIds = new Set<string>();
  for (const m of records) {
    if (Array.isArray(m.chunks_used)) {
      for (const cid of m.chunks_used) allChunkIds.add(cid);
    }
  }

  // Batched chunks+summary-nodes UNION lookup, shared with the share
  // snapshot path — see rehydrateCitations for the SQL and rationale.
  const chunkMap: Map<string, Citation> = await rehydrateCitations(Array.from(allChunkIds));

  const messages: MessageWithCitations[] = records.map(m => ({
    ...m,
    cost_usd: m.cost_usd === null ? null : Number(m.cost_usd),
    citations: Array.isArray(m.chunks_used)
      ? m.chunks_used
          .map(cid => chunkMap.get(cid))
          .filter((c): c is Citation => c !== undefined)
      : [],
  }));

  // Study sessions ship the dossier TOC for the sidebar — display-only,
  // same fetch (summary-phase-w.md §W5); missing dossier = null, no block.
  const study_toc = dossier
    ? {
        work_label: dossier.work_label,
        entries: dossier.structure.map(e => ({ section_span: e.section_span, title: e.title })),
      }
    : null;

  return Response.json({ session, messages, study_toc });
}
