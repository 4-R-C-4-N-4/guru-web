/**
 * src/__tests__/citations.test.ts
 *
 * Unit tests for parseCitationsBlock — the shared splitter that pulls the
 * structured CITATIONS tail (src/lib/prompt.ts contract) off prose and parses
 * its entries into the <Citation> prop shape.
 */

import { describe, it, expect } from 'vitest';
import { parseCitationsBlock } from '@/lib/citations';

const PROSE = 'The One is beyond being.\n\nAnd naming fails it.';

describe('parseCitationsBlock', () => {
  it('returns the input untouched when there is no CITATIONS block', () => {
    const { body, citations } = parseCitationsBlock(PROSE);
    expect(body).toBe(PROSE);
    expect(citations).toEqual([]);
  });

  it('strips the block from the body and parses a single entry', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[neoplatonism | Enneads | V.1 | TIER: verified]`;
    const { body, citations } = parseCitationsBlock(raw);
    expect(body).toBe(PROSE);
    expect(body).not.toContain('CITATIONS:');
    expect(citations).toEqual([
      { tradition: 'neoplatonism', text: 'Enneads', section: 'V.1' },
    ]);
  });

  it('parses multiple entries in order', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[neoplatonism | Enneads | V.1 | TIER: verified]\n[buddhism | Visuddhimagga | IX | TIER: proposed]\n[taoism | Tao Te Ching | 1 | TIER: inferred]`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations.map(c => c.tradition)).toEqual(['neoplatonism', 'buddhism', 'taoism']);
  });

  it('attaches an optional quote line to the preceding entry', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[neoplatonism | Enneads | V.1 | TIER: verified]\n"The One is all things and no one of them."\n[taoism | Tao Te Ching | 1 | TIER: inferred]`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations[0].quote).toBe('The One is all things and no one of them.');
    // The next bracket line is not a quote — entry 2 carries none.
    expect(citations[1].quote).toBeUndefined();
  });

  it('strips curly quotes from a quote line', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[taoism | Tao Te Ching | 1 | TIER: inferred]\n“The name that can be named is not the enduring name.”`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations[0].quote).toBe('The name that can be named is not the enduring name.');
  });

  it('drops the legacy fourth TIER segment and parses tierless entries alike (todo:0f48f68a)', () => {
    // Stored posts/shares emitted before the de-tier carry `| TIER: …`; the
    // current contract has three segments. Both parse to the same shape, and
    // no tier field survives on any entry.
    const raw = `${PROSE}\n\nCITATIONS:\n[a | T1 | S1 | TIER: VERIFIED]\n[b | T2 | S2 | TIER: nonsense]\n[c | T3 | S3]`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations).toEqual([
      { tradition: 'a', text: 'T1', section: 'S1' },
      { tradition: 'b', text: 'T2', section: 'S2' },
      { tradition: 'c', text: 'T3', section: 'S3' },
    ]);
  });

  it('skips malformed entry lines (too few fields or empty tradition/text)', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[only two | fields]\n[ |  | S | TIER: verified]\n[neoplatonism | Enneads | V.1 | TIER: verified]`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations).toHaveLength(1);
    expect(citations[0].tradition).toBe('neoplatonism');
  });

  // Regression (todo:2fd21c61): the model sometimes appends the quote on the
  // SAME line as the bracketed entry rather than on the next line. The fallback
  // parser (chat now seeds cards from the authoritative X-Citations header, so
  // this only feeds the hand-authored blog path) must still recover both the
  // entry and its inline quote.
  it('parses a bracketed entry with an inline quote on the same line', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[neoplatonism | Select Works of Plotinus | Section 275 | tier: verified] “In its character as Life … the Source of plurality.”\n[jewish_mysticism | The Kabbalah Unveiled | Introduction | tier: proposed]`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({
      tradition: 'neoplatonism',
      text: 'Select Works of Plotinus',
      section: 'Section 275',
      quote: 'In its character as Life … the Source of plurality.',
    });
    expect(citations[1].tradition).toBe('jewish_mysticism');
    expect(citations[1].quote).toBeUndefined();
  });

  it('does not false-trigger on the word CITATIONS mid-prose', () => {
    const raw = 'He listed the CITATIONS: inline, then continued.\n\nMore prose.';
    const { body, citations } = parseCitationsBlock(raw);
    // The marker is anchored to line start, so a mid-sentence mention is kept.
    expect(citations).toEqual([]);
    expect(body).toBe(raw);
  });

  it('parses an inline block whose entries share the marker line (todo:2538570b)', () => {
    // A hand-authored / reflowed post can collapse the whole block onto one
    // line: `CITATIONS: [..] [..] [..]`. The old per-following-line scan saw
    // the marker line consumed and zero entries left, so it stripped the block
    // from the body AND rendered no cards — the Sources section vanished. The
    // region scan must recover every entry regardless of newlines.
    const raw =
      `${PROSE}\n\nCITATIONS: ` +
      '[neoplatonism | Select Works of Plotinus (trans. Thomas Taylor) | Section 203 (part 2) | TIER: verified] ' +
      '[taoism | Tao Te Ching (trans. James Legge) | Chapter 1 | TIER: verified] ' +
      '[buddhism | Visuddhimagga | IX | TIER: proposed]';
    const { body, citations } = parseCitationsBlock(raw);
    expect(body).toBe(PROSE);
    expect(body).not.toContain('CITATIONS:');
    expect(citations.map(c => c.tradition)).toEqual(['neoplatonism', 'taoism', 'buddhism']);
    expect(citations[0].text).toBe('Select Works of Plotinus (trans. Thomas Taylor)');
    expect(citations[0].section).toBe('Section 203 (part 2)');
  });

  it('does not treat a lowercase "citations:" line as the marker', () => {
    // The emitted contract is always uppercase; matching lowercase would let
    // ordinary hand-authored prose (a line starting "citations:") truncate the
    // body. Case-sensitive marker keeps it intact.
    const raw = 'Some prose.\n\ncitations: see the index at the back of the book.';
    const { body, citations } = parseCitationsBlock(raw);
    expect(citations).toEqual([]);
    expect(body).toBe(raw);
  });
});
