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
    `SELECT id, title, created_at, updated_at
     FROM sessions
     WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );

  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const records = await query<QueryRecord & {
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
  );

  // Single batched JOIN against corpus.chunks to rehydrate citations.
  // Collect unique chunk IDs across the whole session so we never run
  // more than one chunks-lookup query, even for long sessions.
  const allChunkIds = new Set<string>();
  for (const m of records) {
    if (Array.isArray(m.chunks_used)) {
      for (const cid of m.chunks_used) allChunkIds.add(cid);
    }
  }

  const chunkMap = new Map<string, Citation>();
  if (allChunkIds.size > 0) {
    const rows = await query<{ id: string; tradition: string; text_name: string; section: string }>(
      `SELECT id, tradition, text_name, section
       FROM corpus.chunks
       WHERE id = ANY($1::text[])`,
      [Array.from(allChunkIds)]
    );
    for (const r of rows) {
      chunkMap.set(r.id, {
        tradition: r.tradition,
        text: r.text_name,
        section: r.section,
        tier: 'verified',
      });
    }
  }

  const messages: MessageWithCitations[] = records.map(m => ({
    ...m,
    cost_usd: m.cost_usd === null ? null : Number(m.cost_usd),
    citations: Array.isArray(m.chunks_used)
      ? m.chunks_used
          .map(cid => chunkMap.get(cid))
          .filter((c): c is Citation => c !== undefined)
      : [],
  }));

  return Response.json({ session, messages });
}
