/**
 * src/__tests__/quality-filter.test.ts
 *
 * Unit tests for the retrieval-side corpus-apparatus filter (todo:35c5da28).
 * Pure functions, no DB — cleanBody + applyQualityFilter.
 */
import { describe, it, expect } from 'vitest';
import { cleanBody, applyQualityFilter } from '@/lib/retriever';
import type { RetrievedChunk } from '@/lib/types';

function chunk(id: string, body: string): RetrievedChunk {
  return {
    id, text_id: 't', tradition: 'x', text_name: 'tn', section: 's',
    translator: null, body, token_count: 1, source: 'vector',
  };
}

describe('cleanBody — strip baked-in boilerplate', () => {
  it('strips the Sacred Texts nav prefix and keeps the real content', () => {
    const out = cleanBody('Sacred Texts Buddhism Index Previous Next {p. 111} THE DIAMOND-CUTTER. Adoration.');
    expect(out).not.toMatch(/sacred texts|previous next/i);
    expect(out).not.toContain('{p. 111}');
    expect(out).toContain('THE DIAMOND-CUTTER. Adoration.');
  });

  it('strips {p. N} page markers anywhere in the body', () => {
    const out = cleanBody('All this {p. 23} is Brahman.');
    expect(out).not.toMatch(/\{\s*p\./);
    expect(out).toContain('Brahman');
  });

  it('leaves clean content untouched', () => {
    expect(cleanBody('Tat tvam asi — thou art that.')).toBe('Tat tvam asi — thou art that.');
  });

  // V8 hardening (guru repo docs/summary/boilerplate-audit.md, todo:fccaf47d)
  it('strips the hyphenated Sacred-Texts header without nav links (enuma-elish reproducer)', () => {
    const out = cleanBody('Sacred-Texts Ancient Near East ENUMA ELISH THE EPIC OF CREATION L.W.\n\nTHE FIRST TABLET When in the height');
    expect(out).not.toMatch(/Sacred-Texts/);
    expect(out).toContain('THE FIRST TABLET');
  });

  it('strips inline [Pg N] Gutenberg page markers', () => {
    const out = cleanBody('the Pytha [Pg 2] goreans held that');
    expect(out).not.toMatch(/\[Pg/);
    expect(out).toContain('goreans held that');
  });

  it('strips a trailing Next: nav pointer glued to content', () => {
    const out = cleanBody('analogy will make every part a Sign. Next: Section 6');
    expect(out).toBe('analogy will make every part a Sign.');
  });

  it('does not strip prose that merely mentions sacred texts', () => {
    const prose = 'The sacred texts of this tradition describe the ascent.';
    expect(cleanBody(prose)).toBe(prose);
  });
});

describe('applyQualityFilter — drop apparatus, keep content (todo:35c5da28)', () => {
  it('drops pure nav/TOC/errata chunks; keeps & strips real ones; preserves short real content', () => {
    const out = applyQualityFilter([
      chunk('nav', 'Next: Section 3'),
      chunk('toc', 'Next: Chapter IV. The Book Am-Tuat and the Book of Gates.'),
      chunk('errata', "Errata page 88: 'astonied'->'astonished'"),
      chunk('navonly', 'Sacred Texts Classics Index Previous Next'),
      chunk('real', 'Sacred Texts Classics Index Previous Next Section 11 11. The administration of the kosmos is good.'),
      chunk('logion', "Jesus said, \"Become passers-by.\""),
    ]);
    const ids = out.map(c => c.id);

    // dropped: pure apparatus
    expect(ids).not.toContain('nav');
    expect(ids).not.toContain('toc');
    expect(ids).not.toContain('errata');
    expect(ids).not.toContain('navonly'); // empty once the prefix is stripped

    // kept: real content (prefix stripped on 'real')
    expect(ids).toEqual(expect.arrayContaining(['real', 'logion']));
    const real = out.find(c => c.id === 'real')!;
    expect(real.body).not.toMatch(/sacred texts|previous next/i);
    expect(real.body).toContain('administration of the kosmos');

    // short content is NOT dropped by length — the 9-token logion survives verbatim
    const logion = out.find(c => c.id === 'logion')!;
    expect(logion.body).toBe('Jesus said, "Become passers-by."');
  });

  it('is a no-op shape-wise for already-clean chunks (no new objects unless changed)', () => {
    const clean = chunk('c', 'All this is certainly Brahman.');
    const [out] = applyQualityFilter([clean]);
    expect(out).toBe(clean); // same reference when nothing was stripped
  });
});
