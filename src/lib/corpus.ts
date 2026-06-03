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
