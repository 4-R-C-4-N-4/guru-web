/**
 * src/lib/read-path.ts
 *
 * Pure URL helpers for the source-material reader (/read). Chunk ids are
 * uniformly `<tradition>.<textId>.<NNN>` (verified: every corpus row has
 * exactly two dots and a zero-padded 3-digit suffix), so a chunk id maps
 * losslessly to a reader path and back. Summary-node ids (`sum:...`) get
 * their own /read/summary route since their tradition/text can only be
 * resolved by lookup.
 *
 * No DB access here — these run in client components (citation cards,
 * inline-citation linkifier) as well as server pages.
 */

/** Reader path for a chunk id, or null when the id is not a plain 3-part
 *  chunk id (summary nodes, malformed/legacy ids). Null means "don't link". */
export function chunkIdToPath(id: string): string | null {
  if (id.startsWith('sum:')) return null;
  const parts = id.split('.');
  if (parts.length !== 3 || parts.some(p => p.length === 0)) return null;
  return `/read/${parts[0]}/${parts[1]}/${parts[2]}`;
}

/** Rebuild the chunk id from reader route params. Exact-match: `n` must be
 *  the stored zero-padded suffix or the lookup 404s — link emitters always
 *  use chunkIdToPath, so unpadded URLs only arise from hand-typing. */
export function pathToChunkId(tradition: string, textId: string, n: string): string {
  return `${tradition}.${textId}.${n}`;
}

/** Reader href for any citation id — chunk or summary node — or null when
 *  unlinkable. The single decision point for Citation cards and the inline
 *  linkifier, so the two surfaces can never disagree on what links. */
export function citationHref(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.startsWith('sum:')) return `/read/summary/${encodeURIComponent(id)}`;
  return chunkIdToPath(id);
}

/** Human labels for texts.sections_format, used as the TOC list eyebrow.
 *  Values verified against `SELECT DISTINCT sections_format FROM texts`. */
export const SECTION_FORMAT_LABELS: Record<string, string> = {
  book:          'Books',
  chapter:       'Chapters',
  document:      'Documents',
  hymn_number:   'Hymns',
  logion:        'Logia',
  paragraph:     'Paragraphs',
  rune:          'Runes',
  section:       'Sections',
  tablet:        'Tablets',
  tale:          'Tales',
  yasna_chapter: 'Chapters',
};

export function sectionFormatLabel(format: string | null): string {
  return (format && SECTION_FORMAT_LABELS[format]) || 'Sections';
}
