/**
 * src/lib/citations.ts
 *
 * Shared parser for the structured CITATIONS tail block that the model emits
 * after its prose (contract in src/lib/prompt.ts CORE_RULES / the blog
 * essayist prompt):
 *
 *   CITATIONS:
 *   [TRADITION | TEXT | SECTION]
 *   "optional short quote"
 *   [ ...more entries... ]
 *
 * Entries may carry a legacy fourth `| TIER: …` segment (stored posts and
 * shares emitted before todo:0f48f68a) — it is parsed past and dropped: the
 * tier column recorded which tool wrote an edge, not confidence, so it is no
 * longer surfaced anywhere.
 *
 * Three surfaces need to render that block as styled <Citation> cards rather
 * than raw markdown text:
 *   - chat (chat-view.tsx) — strip it from the streamed prose
 *   - hand-authored / edited blog posts (blog/[slug]/page.tsx) — turn it into
 *     a Sources block when the post has no structured chunks_used
 *   - the blog generator (blog-generate.ts) already stripped it inline; that
 *     strip now delegates here so there is ONE CITATIONS regex in the tree.
 *
 * parseCitationsBlock returns the prose with the block removed plus the parsed
 * entries. The ParsedCitation shape lines up with citation.tsx's CitationProps
 * so entries can be spread straight into <Citation {...c} />.
 */

export interface ParsedCitation {
  tradition: string;
  text: string;
  section: string;
  quote?: string;
}

// The CITATIONS: marker on its own line — everything from here to EOF is the
// block. Anchored to line start (m flag) so a stray "CITATIONS:" mid-sentence
// doesn't trigger a false strip. Case-SENSITIVE on purpose: the emitted
// contract (prompt.ts) is always uppercase CITATIONS:, and matching a
// lowercase "citations:" line would let ordinary hand-authored prose
// truncate the body.
const MARKER_RE = /^[^\S\n]*CITATIONS:[^\n]*$/m;

// A line whose first non-space char is a quote glyph is treated as the quote
// for the preceding entry. Strip the surrounding straight/curly quotes.
function asQuote(line: string): string | undefined {
  if (!/^["“'']/.test(line)) return undefined;
  const inner = line.replace(/^["“'']\s*/, '').replace(/\s*["”'']$/, '').trim();
  return inner || undefined;
}

// Each [ ... ] citation entry. Scanned globally over the block region (not
// per-line) so entries collapsed onto one line — e.g. a hand-authored post
// whose block reads `CITATIONS: [..] [..] [..]`, or any source that reflows
// the newlines — parse the same as the newline-delimited contract form.
const ENTRY_RE = /\[([^\]]+)\]/g;

// The first quote-glyph line in the gap between one entry and the next is that
// entry's optional quote. Inline blocks have no such line (the gap is a space),
// so they simply carry no quote — the newline contract still attaches one.
function quoteFromGap(gap: string): string | undefined {
  for (const line of gap.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    return asQuote(t); // undefined unless this line is a quote line
  }
  return undefined;
}

/**
 * Split prose from its trailing CITATIONS block.
 *
 * Returns `{ body, citations }` where `body` is the input with the block
 * removed (trimmed) and `citations` is the parsed entries. When no block is
 * present, `citations` is empty and `body` is the trimmed input. Malformed
 * entry lines (fewer than three `|`-separated fields, or empty tradition/text)
 * are skipped rather than throwing.
 */
export function parseCitationsBlock(raw: string): { body: string; citations: ParsedCitation[] } {
  const text = (raw ?? '').trim();
  const marker = MARKER_RE.exec(text);
  if (!marker) return { body: text, citations: [] };

  const body = text.slice(0, marker.index).trim();
  // The block is everything from the marker to EOF. Scan it for [ ... ] groups
  // rather than splitting on '\n' and requiring one entry per line: the entries
  // may be newline-delimited (the emitted contract) OR collapsed onto the
  // marker line itself (a hand-authored / reflowed block — the regression that
  // made Sources vanish, todo:2538570b). The literal `CITATIONS:` keyword holds
  // no brackets, so leaving it in the scanned region is harmless.
  const block = text.slice(marker.index);
  const matches = [...block.matchAll(ENTRY_RE)];

  const citations: ParsedCitation[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const parts = m[1].split('|').map(s => s.trim());
    if (parts.length < 3) continue; // need at least tradition, text, section
    const [tradition, textName, section] = parts; // 4th (legacy TIER) segment dropped
    if (!tradition || !textName) continue;

    // Optional quote: a quote line in the gap before the next entry (or EOF).
    // Newline blocks put it on its own line; inline blocks have no quote.
    const gapStart = m.index + m[0].length;
    const gapEnd = i + 1 < matches.length ? matches[i + 1].index : block.length;
    const quote = quoteFromGap(block.slice(gapStart, gapEnd));

    citations.push({
      tradition,
      text: textName,
      section: section ?? '',
      ...(quote ? { quote } : {}),
    });
  }

  return { body, citations };
}
