/**
 * src/lib/seo.ts
 *
 * Meta-description builders for the public reader (todo:17621cef).
 *
 * The passage pages used to describe themselves with the first 160 chars of
 * the passage body. That text is public-domain and hosted on many other
 * sites, so to a search engine the description read as a duplicate — and
 * where a chunk opens with translator apparatus it was literally footnote
 * fragments. The annotation layer (concept tags, cross-tradition parallels)
 * is the only part of a passage page that exists nowhere else, so it is
 * what the description sells. Pure functions, no DB access.
 */

import type { ChunkPage, ChunkTag, RelatedPassage } from '@/lib/reader';

/** Soft cap for description length. Google truncates around ~160 chars;
 *  we cut at a word boundary rather than let the SERP ellipsize mid-word. */
const DESC_MAX = 220;

const MAX_CONCEPTS = 3;
const MAX_PARTNER_TRADITIONS = 2;

function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max / 2 ? lastSpace : max - 1).replace(/[,;:—–-]$/, '')}…`;
}

/** Collapse newlines/runs of whitespace — descriptions must be single-line. */
function singleLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** RelatedPassage.tradition is the traditions FK slug (`christian_mysticism`),
 *  not the display label — humanize it rather than drag another join into
 *  generateMetadata. Title-case-per-word is faithful for every current slug. */
function humanizeTradition(slug: string): string {
  return slug.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Description for a passage page, annotation-first:
 *
 *   "Tao Te Ching Ch. 1 (Taoism) — apophatic theology, wu wei, the nameless;
 *    parallels in Christian Mysticism and Buddhism. Every connection cited."
 *
 * Falls back to a library boilerplate (still unique per page via the
 * section/text names) when a chunk has no annotations yet — never to the
 * passage body, which is duplicate content everywhere it appears.
 */
export function chunkMetaDescription(
  chunk: Pick<ChunkPage, 'section' | 'pos' | 'text_label' | 'tradition_label' | 'tradition'>,
  tags: Pick<ChunkTag, 'label'>[],
  related: Pick<RelatedPassage, 'edge_type' | 'tradition'>[],
): string {
  const section = chunk.section ?? `Passage ${chunk.pos}`;
  const base = `${section} of ${chunk.text_label} (${chunk.tradition_label})`;

  const concepts = tags.slice(0, MAX_CONCEPTS).map(t => t.label);
  const partnerTraditions = [...new Set(
    related.map(r => r.tradition).filter(t => t !== chunk.tradition),
  )].map(humanizeTradition);

  if (concepts.length === 0 && related.length === 0) {
    return singleLine(truncateAtWord(
      `${base} — read passage by passage with concept tags and cross-tradition parallels in Guru's source library.`,
      DESC_MAX,
    ));
  }

  const parts: string[] = [];
  if (concepts.length > 0) parts.push(concepts.join(', '));
  if (related.length > 0) {
    const shown = partnerTraditions.slice(0, MAX_PARTNER_TRADITIONS);
    parts.push(shown.length > 0
      ? `parallels in ${shown.join(' and ')}${partnerTraditions.length > shown.length ? ' and beyond' : ''}`
      : `${related.length} cross-tradition ${related.length === 1 ? 'parallel' : 'parallels'}`);
  }

  return singleLine(truncateAtWord(
    `${base} — ${parts.join('; ')}. Every connection cited.`,
    DESC_MAX,
  ));
}
