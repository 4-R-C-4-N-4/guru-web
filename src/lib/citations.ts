/**
 * src/lib/citations.ts
 *
 * Shared parser for the structured CITATIONS tail block that the model emits
 * after its prose (contract in src/lib/prompt.ts CORE_RULES / the blog
 * essayist prompt):
 *
 *   CITATIONS:
 *   [TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred]
 *   "optional short quote"
 *   [ ...more entries... ]
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

export type CitationTier = 'verified' | 'proposed' | 'inferred';

export interface ParsedCitation {
  tradition: string;
  text: string;
  section: string;
  tier: CitationTier;
  quote?: string;
}

// The CITATIONS: marker on its own line — everything from here to EOF is the
// block. Anchored to line start (m flag) so a stray "CITATIONS:" mid-sentence
// doesn't trigger a false strip. Case-SENSITIVE on purpose: the emitted
// contract (prompt.ts) is always uppercase CITATIONS:, and matching a
// lowercase "citations:" line would let ordinary hand-authored prose
// truncate the body.
const MARKER_RE = /^[^\S\n]*CITATIONS:[^\n]*$/m;

function normalizeTier(raw: string | undefined): CitationTier {
  const v = (raw ?? '').replace(/^TIER:\s*/i, '').trim().toLowerCase();
  return v === 'verified' || v === 'proposed' || v === 'inferred' ? v : 'inferred';
}

// A line whose first non-space char is a quote glyph is treated as the quote
// for the preceding entry. Strip the surrounding straight/curly quotes.
function asQuote(line: string): string | undefined {
  if (!/^["“'']/.test(line)) return undefined;
  const inner = line.replace(/^["“'']\s*/, '').replace(/\s*["”'']$/, '').trim();
  return inner || undefined;
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
  const blockLines = text.slice(marker.index + marker[0].length).split('\n');

  const citations: ParsedCitation[] = [];
  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i].trim();
    const bracket = line.match(/^\[(.+)\]$/);
    if (!bracket) continue;

    const parts = bracket[1].split('|').map(s => s.trim());
    if (parts.length < 3) continue; // need at least tradition, text, section
    const [tradition, textName, section, tierRaw] = parts;
    if (!tradition || !textName) continue;

    // Optional quote: the immediate next non-empty line, if it's a quote line.
    let quote: string | undefined;
    for (let j = i + 1; j < blockLines.length; j++) {
      const next = blockLines[j].trim();
      if (!next) continue;
      quote = asQuote(next); // undefined if the next entry's bracket, not a quote
      break;
    }

    citations.push({
      tradition,
      text: textName,
      section: section ?? '',
      tier: normalizeTier(tierRaw),
      ...(quote ? { quote } : {}),
    });
  }

  return { body, citations };
}
