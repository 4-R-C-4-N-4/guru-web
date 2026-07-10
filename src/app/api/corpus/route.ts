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
    // GROUP BY yields the same distinct (tradition, text_id, text_name)
    // rows the old SELECT DISTINCT did, plus a chunk count per row — the
    // per-tradition totals weight the scope spectrum bar (todo:5b6d6a14).
    query<{ tradition: string; text_id: string; text_name: string; chunks: number }>(
      `SELECT tradition, text_id, text_name, count(*)::int AS chunks
         FROM chunks
         WHERE tradition IS NOT NULL AND text_name IS NOT NULL
         GROUP BY tradition, text_id, text_name
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
  // The finer grouping (text_id added for the study picker) would emit one
  // row per member text of a grouped work — 26× "The Dhammapada" — so both
  // arrays dedupe on display label. `id` keeps the first member id (any
  // member pins the same work for the picker); `ids` accumulates ALL member
  // ids because scope blocking filters on text_id — blocking a label must
  // block every member, or 25 of 26 Dhammapada texts stay retrievable
  // (todo:5b6d6a14). `chunks` per tradition weights the scope spectrum bar.
  const traditions: Record<string, {
    texts: string[];
    text_items: { id: string; label: string; ids: string[] }[];
    chunks: number;
  }> = {};
  const itemByLabel = new Map<string, { id: string; label: string; ids: string[] }>();
  for (const { tradition, text_id, text_name, chunks } of rows) {
    if (!traditions[tradition]) traditions[tradition] = { texts: [], text_items: [], chunks: 0 };
    traditions[tradition].chunks += chunks;
    const key = `${tradition}\u0000${text_name}`;
    const existing = itemByLabel.get(key);
    if (existing) {
      existing.ids.push(text_id);
      continue;
    }
    const item = { id: text_id, label: text_name, ids: [text_id] };
    itemByLabel.set(key, item);
    traditions[tradition].texts.push(text_name);
    traditions[tradition].text_items.push(item);
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
