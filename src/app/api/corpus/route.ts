/**
 * src/app/api/corpus/route.ts
 *
 * GET /api/corpus — list traditions and their texts derived from the corpus.
 *
 * Aggregated from `chunks` (the actually-retrievable surface), not from
 * separate metadata tables, so the UI cannot offer a tradition or text the
 * retriever can't deliver. Empty response is meaningful: it means the
 * corpus has not been restored. The client must NOT substitute a fallback —
 * surface the empty/error state so the broken upstream is visible.
 */

import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;

  const [rows, workRows] = await Promise.all([
    query<{ tradition: string; text_id: string; text_name: string }>(
      `SELECT DISTINCT tradition, text_id, text_name
         FROM chunks
         WHERE tradition IS NOT NULL AND text_name IS NOT NULL
         ORDER BY tradition, text_name`,
    ),
    // Works are the study-mode unit (one dossier, one pin) — 52 entries,
    // not one per member text. The picker pins via the first member id,
    // which resolves to the same work server-side.
    query<{ id: string; label: string; tradition: string; member_text_ids: string[] }>(
      `SELECT id, label, tradition, member_text_ids
         FROM works
         ORDER BY tradition, label`,
    ),
  ]);

  // `texts` (names only) predates the study picker and is kept verbatim for
  // existing consumers; `text_items` adds the ids the picker POSTs as
  // study_text_id (summary-phase-w.md §W5).
  // The finer DISTINCT (text_id added for the study picker) would emit one
  // row per member text of a grouped work — 26× "The Dhammapada" — so both
  // arrays dedupe on display label. Any member id pins the same work, so
  // keeping the first id per label loses nothing for the picker.
  const traditions: Record<string, { texts: string[]; text_items: { id: string; label: string }[] }> = {};
  const seen = new Set<string>();
  for (const { tradition, text_id, text_name } of rows) {
    if (!traditions[tradition]) traditions[tradition] = { texts: [], text_items: [] };
    const key = `${tradition}\u0000${text_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    traditions[tradition].texts.push(text_name);
    traditions[tradition].text_items.push({ id: text_id, label: text_name });
  }

  const works = workRows.map(w => ({
    id: w.id,
    label: w.label,
    tradition: w.tradition,
    members: w.member_text_ids.length,
    pin_text_id: w.member_text_ids[0],
  }));

  return Response.json({ traditions, works });
}
