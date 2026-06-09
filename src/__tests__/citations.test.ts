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
      { tradition: 'neoplatonism', text: 'Enneads', section: 'V.1', tier: 'verified' },
    ]);
  });

  it('parses multiple entries in order', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[neoplatonism | Enneads | V.1 | TIER: verified]\n[buddhism | Visuddhimagga | IX | TIER: proposed]\n[taoism | Tao Te Ching | 1 | TIER: inferred]`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations.map(c => c.tradition)).toEqual(['neoplatonism', 'buddhism', 'taoism']);
    expect(citations.map(c => c.tier)).toEqual(['verified', 'proposed', 'inferred']);
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

  it('normalizes tier casing and an unknown/missing tier falls back to inferred', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[a | T1 | S1 | TIER: VERIFIED]\n[b | T2 | S2 | TIER: nonsense]\n[c | T3 | S3]`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations.map(c => c.tier)).toEqual(['verified', 'inferred', 'inferred']);
  });

  it('skips malformed entry lines (too few fields or empty tradition/text)', () => {
    const raw = `${PROSE}\n\nCITATIONS:\n[only two | fields]\n[ |  | S | TIER: verified]\n[neoplatonism | Enneads | V.1 | TIER: verified]`;
    const { citations } = parseCitationsBlock(raw);
    expect(citations).toHaveLength(1);
    expect(citations[0].tradition).toBe('neoplatonism');
  });

  it('does not false-trigger on the word CITATIONS mid-prose', () => {
    const raw = 'He listed the CITATIONS: inline, then continued.\n\nMore prose.';
    const { body, citations } = parseCitationsBlock(raw);
    // The marker is anchored to line start, so a mid-sentence mention is kept.
    expect(citations).toEqual([]);
    expect(body).toBe(raw);
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
