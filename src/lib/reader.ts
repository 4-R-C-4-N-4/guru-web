/**
 * src/lib/reader.ts
 *
 * Server-side reads for the public source-material reader (/read): traditions
 * → texts → chunk pages, plus per-chunk tags (EXPRESSES edges), related
 * passages (PARALLELS/CONTRASTS edges) and study summaries (summary_nodes).
 *
 * Same conventions as src/lib/corpus.ts: raw parameterized SQL through
 * src/lib/db.ts (search_path resolves bare corpus table names), typed rows,
 * no ORM. Everything here is read-only over the imported corpus schema.
 *
 * Reading order: chunk ids are `<tradition>.<textId>.<NNN>` with a
 * zero-padded suffix, so ORDER BY id IS reading order within a text
 * (section_path is unpopulated in the export — do not use it). Reading
 * order across the texts of a grouped work is works.member_text_ids.
 */

import { unstable_cache } from 'next/cache';
import { query, one } from './db';

/* ---------------------------------- types --------------------------------- */

export interface ReaderTradition {
  id: string;
  label: string;
  description: string | null;
  texts: number;
  chunks: number;
}

export interface ReaderTextRow {
  work_id: string;
  work_label: string;
  member_text_ids: string[];
  text_id: string;
  label: string;
  translator: string | null;
  chunks: number;
}

export interface ReaderWork {
  work_id: string;
  work_label: string;
  texts: ReaderTextRow[];
}

export interface TocEntry {
  id: string;
  section: string | null;
  token_count: number;
}

export interface TextMeta {
  id: string;
  tradition: string;
  tradition_label: string;
  label: string;
  translator: string | null;
  source_url: string | null;
  sections_format: string | null;
  work_id: string;
  work_label: string;
  member_text_ids: string[];
}

export interface SpanSummary {
  id: string;
  section_span: string | null;
  child_chunk_ids: string[];
  body: string;
}

/** Prev/next link target. crossText marks a hop into an adjacent member
 *  text of the same work, so the UI can label it with the target text. */
export interface ChunkNav {
  id: string;
  section: string | null;
  textLabel: string | null;
  crossText: boolean;
}

export interface ChunkPage {
  id: string;
  text_id: string;
  tradition: string;
  tradition_label: string;
  text_name: string;
  text_label: string;
  section: string | null;
  translator: string | null;
  body: string;
  token_count: number;
  source_url: string | null;
  sections_format: string | null;
  work_id: string;
  pos: number;
  total: number;
  prev: ChunkNav | null;
  next: ChunkNav | null;
}

export interface ChunkTag {
  concept_id: string;
  tier: string;
  annotation: string | null;
  label: string;
  domain: string | null;
  definition: string | null;
}

export interface RelatedPassage {
  edge_type: 'PARALLELS' | 'CONTRASTS';
  tier: string;
  annotation: string | null;
  partner_id: string;
  tradition: string;
  text_name: string;
  section: string | null;
  preview: string;
}

export interface ConceptRow {
  id: string;
  label: string;
  domain: string | null;
  definition: string | null;
}

export interface ExpressingChunk {
  id: string;
  tradition: string;
  text_name: string;
  section: string | null;
  preview: string;
  tier: string;
}

export interface SummaryPage {
  id: string;
  work_id: string;
  work_label: string;
  text_id: string | null;
  text_label: string | null;
  tradition: string;
  tradition_label: string;
  level: number;
  section_span: string | null;
  body: string;
  child_chunk_ids: string[];
}

/* ------------------------------- traditions ------------------------------- */

/** Traditions with text/chunk counts, most-represented first — mirrors the
 *  listTraditions() ordering so the reader index matches the landing strip. */
export async function listTraditionsForReader(): Promise<ReaderTradition[]> {
  return query<ReaderTradition>(
    `SELECT t.id, t.label, t.description,
            COUNT(DISTINCT c.text_id)::int AS texts,
            COUNT(*)::int                  AS chunks
       FROM chunks c
       JOIN traditions t ON t.id = c.tradition
      GROUP BY t.id, t.label, t.description
      ORDER BY COUNT(*) DESC, t.label`,
  );
}

/* --------------------------------- texts ---------------------------------- */

/** Texts of a tradition grouped by work, members in works.member_text_ids
 *  order. Single-member works render flat; multi-member works (Dhammapada's
 *  26 chapter-texts, Agrippa's 74) render as one card with ordered parts. */
export async function listTextsForTradition(tradition: string): Promise<ReaderWork[]> {
  const rows = await query<ReaderTextRow>(
    `SELECT w.id AS work_id, w.label AS work_label, w.member_text_ids,
            tx.id AS text_id, tx.label, tx.translator,
            COUNT(c.id)::int AS chunks
       FROM works w
       JOIN texts tx ON tx.work_id = w.id
       JOIN chunks c ON c.text_id = tx.id
      WHERE w.tradition = $1
      GROUP BY w.id, w.label, w.member_text_ids, tx.id, tx.label, tx.translator
      ORDER BY w.label, array_position(w.member_text_ids, tx.id)`,
    [tradition],
  );
  const works: ReaderWork[] = [];
  for (const row of rows) {
    const last = works[works.length - 1];
    if (last && last.work_id === row.work_id) last.texts.push(row);
    else works.push({ work_id: row.work_id, work_label: row.work_label, texts: [row] });
  }
  return works;
}

/** Text metadata + full ordered section list for the TOC page. */
export async function getTextToc(textId: string): Promise<{
  text: TextMeta;
  toc: TocEntry[];
  spans: SpanSummary[];
  workSummary: SpanSummary | null;
} | null> {
  const text = await one<TextMeta>(
    `SELECT tx.id, tx.tradition, tr.label AS tradition_label, tx.label,
            tx.translator, tx.source_url, tx.sections_format,
            tx.work_id, w.label AS work_label, w.member_text_ids
       FROM texts tx
       JOIN works w       ON w.id = tx.work_id
       JOIN traditions tr ON tr.id = tx.tradition
      WHERE tx.id = $1`,
    [textId],
  );
  if (!text) return null;

  const [toc, spans, workSummary] = await Promise.all([
    query<TocEntry>(
      `SELECT id, section, token_count FROM chunks WHERE text_id = $1 ORDER BY id`,
      [textId],
    ),
    // Level-1 span summaries group the TOC into a study outline. Ordered by
    // first child chunk id — span slugs sort badly (roman numerals), child
    // chunk ids are canonical reading order.
    query<SpanSummary>(
      `SELECT id, section_span, child_chunk_ids, body
         FROM summary_nodes
        WHERE text_id = $1 AND level = 1
        ORDER BY child_chunk_ids[1]`,
      [textId],
    ),
    one<SpanSummary>(
      `SELECT s.id, s.section_span, s.child_chunk_ids, s.body
         FROM summary_nodes s JOIN texts tx ON tx.work_id = s.work_id
        WHERE tx.id = $1 AND s.level = 2`,
      [textId],
    ),
  ]);
  return { text, toc, spans, workSummary };
}

/* --------------------------------- chunks --------------------------------- */

interface BoundaryChunk { id: string; section: string | null; text_label: string }

/** First or last chunk of the member text adjacent to `textId` in the work,
 *  for cross-text prev/next continuation. Direction +1 = next, -1 = prev. */
async function adjacentTextBoundary(
  memberTextIds: string[],
  textId: string,
  direction: 1 | -1,
): Promise<ChunkNav | null> {
  const idx = memberTextIds.indexOf(textId);
  if (idx === -1) return null;
  const adjacent = memberTextIds[idx + direction];
  if (!adjacent) return null;
  const row = await one<BoundaryChunk>(
    `SELECT c.id, c.section, tx.label AS text_label
       FROM chunks c JOIN texts tx ON tx.id = c.text_id
      WHERE c.text_id = $1
      ORDER BY c.id ${direction === 1 ? 'ASC' : 'DESC'}
      LIMIT 1`,
    [adjacent],
  );
  return row ? { id: row.id, section: row.section, textLabel: row.text_label, crossText: true } : null;
}

/** Everything the chunk viewer needs: chunk + text + tradition metadata,
 *  position ("12 of 74"), and prev/next in reading order — continuing into
 *  the adjacent member text of the same work at text boundaries. */
export async function getChunkPage(chunkId: string): Promise<ChunkPage | null> {
  const chunk = await one<Omit<ChunkPage, 'pos' | 'total' | 'prev' | 'next'> & { member_text_ids: string[] }>(
    `SELECT c.id, c.text_id, c.tradition, c.text_name, c.section, c.translator,
            c.body, c.token_count,
            tx.label AS text_label, tx.source_url, tx.sections_format, tx.work_id,
            tr.label AS tradition_label,
            w.member_text_ids
       FROM chunks c
       JOIN texts tx      ON tx.id = c.text_id
       JOIN traditions tr ON tr.id = c.tradition
       JOIN works w       ON w.id = tx.work_id
      WHERE c.id = $1`,
    [chunkId],
  );
  if (!chunk) return null;

  const [prevRow, nextRow, posRow] = await Promise.all([
    one<{ id: string; section: string | null }>(
      `SELECT id, section FROM chunks WHERE text_id = $1 AND id < $2 ORDER BY id DESC LIMIT 1`,
      [chunk.text_id, chunkId],
    ),
    one<{ id: string; section: string | null }>(
      `SELECT id, section FROM chunks WHERE text_id = $1 AND id > $2 ORDER BY id ASC LIMIT 1`,
      [chunk.text_id, chunkId],
    ),
    one<{ total: number; pos: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE id <= $2)::int AS pos
         FROM chunks WHERE text_id = $1`,
      [chunk.text_id, chunkId],
    ),
  ]);

  const { member_text_ids, ...rest } = chunk;
  const [prev, next] = await Promise.all([
    prevRow
      ? Promise.resolve<ChunkNav>({ ...prevRow, textLabel: null, crossText: false })
      : adjacentTextBoundary(member_text_ids, chunk.text_id, -1),
    nextRow
      ? Promise.resolve<ChunkNav>({ ...nextRow, textLabel: null, crossText: false })
      : adjacentTextBoundary(member_text_ids, chunk.text_id, 1),
  ]);

  return { ...rest, pos: posRow?.pos ?? 1, total: posRow?.total ?? 1, prev, next };
}

/** Live concept tags for a chunk — EXPRESSES edges joined to concepts,
 *  strongest tier first. (staged_tags never reach this DB; the export only
 *  carries promoted edges.) */
export async function getChunkTags(chunkId: string): Promise<ChunkTag[]> {
  return query<ChunkTag>(
    `SELECT e.target AS concept_id, e.tier, e.annotation,
            co.label, co.domain, co.definition
       FROM edges e
       JOIN concepts co ON co.id = e.target
      WHERE e.source = $1 AND e.edge_type = 'EXPRESSES'
      ORDER BY CASE e.tier WHEN 'verified' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END,
               co.label`,
    [chunkId],
  );
}

/** Cross-tradition partners of a chunk. PARALLELS/CONTRASTS edges are stored
 *  one direction, so match both ends and join the partner endpoint (same
 *  idiom as graph.ts walkGraph). The stored annotation is the reviewed
 *  justification — rendered verbatim as the relationship explanation. */
export async function getRelatedPassages(chunkId: string): Promise<RelatedPassage[]> {
  return query<RelatedPassage>(
    `SELECT e.edge_type, e.tier, e.annotation,
            p.id AS partner_id, p.tradition, p.text_name, p.section,
            LEFT(p.body, 240) AS preview
       FROM edges e
       JOIN chunks p ON p.id = CASE WHEN e.source = $1 THEN e.target ELSE e.source END
      WHERE (e.source = $1 OR e.target = $1)
        AND e.edge_type = ANY(ARRAY['PARALLELS','CONTRASTS'])
      ORDER BY e.edge_type = 'CONTRASTS',
               CASE e.tier WHEN 'verified' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END,
               p.id`,
    [chunkId],
  );
}

/* -------------------------------- concepts -------------------------------- */

export async function getConcept(conceptId: string): Promise<ConceptRow | null> {
  return one<ConceptRow>(
    `SELECT id, label, domain, definition FROM concepts WHERE id = $1`,
    [conceptId],
  );
}

/** Every chunk expressing a concept, for the concept page. */
export async function listChunksExpressing(conceptId: string): Promise<ExpressingChunk[]> {
  return query<ExpressingChunk>(
    `SELECT c.id, c.tradition, c.text_name, c.section,
            LEFT(c.body, 240) AS preview, e.tier
       FROM edges e
       JOIN chunks c ON c.id = e.source
      WHERE e.target = $1 AND e.edge_type = 'EXPRESSES'
      ORDER BY CASE e.tier WHEN 'verified' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END,
               c.id`,
    [conceptId],
  );
}

/* -------------------------------- summaries ------------------------------- */

/** A summary node with resolved labels, for the /read/summary/[sumId] page.
 *  Level 1 = section-span summary of a text; level 2 = whole-work summary. */
export async function getSummaryPage(sumId: string): Promise<SummaryPage | null> {
  return one<SummaryPage>(
    `SELECT s.id, s.work_id, w.label AS work_label,
            s.text_id, tx.label AS text_label,
            s.tradition, tr.label AS tradition_label,
            s.level, s.section_span, s.body, s.child_chunk_ids
       FROM summary_nodes s
       JOIN works w       ON w.id = s.work_id
       JOIN traditions tr ON tr.id = s.tradition
       LEFT JOIN texts tx ON tx.id = s.text_id
      WHERE s.id = $1`,
    [sumId],
  );
}

/** Resolve chunk ids to section labels for a summary page's child list. */
export async function getChunkSections(chunkIds: string[]): Promise<{ id: string; section: string | null; text_name: string }[]> {
  if (chunkIds.length === 0) return [];
  return query<{ id: string; section: string | null; text_name: string }>(
    `SELECT id, section, text_name FROM chunks WHERE id = ANY($1::text[]) ORDER BY id`,
    [chunkIds],
  );
}

/* --------------------------------- sitemap -------------------------------- */

/** Id-only scans backing the reader's sitemap entries. */
export async function listSitemapCorpus(): Promise<{
  texts: { id: string; tradition: string }[];
  chunks: { id: string }[];
}> {
  const [texts, chunks] = await Promise.all([
    query<{ id: string; tradition: string }>(`SELECT id, tradition FROM texts ORDER BY id`),
    query<{ id: string }>(`SELECT id FROM chunks ORDER BY id`),
  ]);
  return { texts, chunks };
}

/** Cached for the sitemap route: the corpus only changes on operator
 *  re-import, so crawler fetches of /sitemap.xml share one scan instead of
 *  re-reading ~4.4k ids per hit — same contract as listTraditionsCached. */
export const listSitemapCorpusCached = unstable_cache(
  () => listSitemapCorpus(),
  ['reader:listSitemapCorpus'],
  { revalidate: 3600, tags: ['corpus-traditions'] },
);

/** Member texts of a work with labels, in reading order — the child list
 *  for whole-work (level-2) summary pages. */
export async function listWorkMembers(workId: string): Promise<{ id: string; tradition: string; label: string }[]> {
  return query<{ id: string; tradition: string; label: string }>(
    `SELECT tx.id, tx.tradition, tx.label
       FROM works w
       JOIN texts tx ON tx.id = ANY(w.member_text_ids)
      WHERE w.id = $1
      ORDER BY array_position(w.member_text_ids, tx.id)`,
    [workId],
  );
}
