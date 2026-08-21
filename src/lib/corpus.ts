/**
 * src/lib/corpus.ts
 *
 * Server-side reads over the retrievable corpus surface, for public pages that
 * can't call the requireUser-gated /api/corpus (e.g. the signed-out homepage).
 */

import { unstable_cache } from 'next/cache';
import { query } from './db';

/**
 * Distinct traditions present in the corpus, most-represented first (by chunk
 * count). Aggregated from `chunks` — the same retrievable surface /api/corpus
 * uses — so we never advertise a tradition the retriever can't deliver.
 *
 * An empty result is meaningful (corpus not restored); callers must surface it,
 * not substitute a hardcoded list. (search_path=public,corpus resolves the bare
 * `chunks` name — see src/lib/db.ts.)
 */
export async function listTraditions(): Promise<string[]> {
  const rows = await query<{ tradition: string }>(
    `SELECT tradition
       FROM chunks
      WHERE tradition IS NOT NULL
      GROUP BY tradition
      ORDER BY COUNT(*) DESC, tradition`,
  );
  return rows.map(r => r.tradition);
}

/**
 * Cached listTraditions for the public homepage. The tradition set only changes
 * on a corpus re-import (operator-driven, rare), so a long revalidate is safe —
 * bot traffic on / shares one aggregation rather than running GROUP BY per hit.
 * A corpus re-import that needs the badges refreshed sooner can revalidateTag.
 */
export const listTraditionsCached = unstable_cache(
  () => listTraditions(),
  ['corpus:listTraditions'],
  { revalidate: 3600, tags: ['corpus-traditions'] },
);

/**
 * Rehydrate bare chunk/summary-node ids into citation display fields via one
 * batched UNION lookup — chunks and study-mode summary nodes in a single
 * round-trip (summary-phase-w.md §W5). Extracted from the sessions/[id] GET
 * so the share-snapshot path (todo:131dbb82) doesn't grow a second copy of
 * the SQL. Ids no longer present in the corpus are simply absent from the
 * map — same graceful-drop the session view has always had.
 *
 * Values carry the source id so snapshot writers (session_shares.messages)
 * can persist it; Citation-shaped consumers just ignore the extra field.
 */
export async function rehydrateCitations(
  chunkIds: string[],
): Promise<Map<string, { id: string; tradition: string; text: string; section: string }>> {
  const map = new Map<string, { id: string; tradition: string; text: string; section: string }>();
  if (chunkIds.length === 0) return map;

  const rows = await query<{ id: string; tradition: string; text_name: string; section: string; src: string }>(
    `SELECT id, tradition, text_name, section, 'chunk' AS src
     FROM corpus.chunks
     WHERE id = ANY($1::text[])
     UNION ALL
     SELECT s.id,
            s.tradition,
            COALESCE(tx.label, w.label)            AS text_name,
            COALESCE(s.section_span, 'Whole work') AS section,
            'summary' AS src
     FROM corpus.summary_nodes s
     JOIN corpus.works w       ON w.id = s.work_id
     LEFT JOIN corpus.texts tx ON tx.id = s.text_id
     WHERE s.id = ANY($1::text[])`,
    [chunkIds],
  );
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      tradition: r.tradition,
      text: r.text_name,
      section: r.section, // identical to the live X-Citations path; the `sum:` id prefix carries the summary signal
    });
  }
  return map;
}
