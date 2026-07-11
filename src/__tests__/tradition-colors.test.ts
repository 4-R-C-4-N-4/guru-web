/**
 * src/__tests__/tradition-colors.test.ts
 *
 * tokens.tradition is the app-wide tradition→color map (citations, badges,
 * settings). Its keys must be real corpus tradition slugs — the old map carried
 * three that don't exist in `chunks` (vedanta, kabbalah, mysticism), so the
 * homepage advertised fictional traditions and real ones (egyptian,
 * jewish_mysticism, zoroastrianism, …) fell back to grey. Guard the alignment.
 */
import { describe, it, expect } from 'vitest';
import { tokens } from '@/styles/tokens';

const keys = Object.keys(tokens.tradition);

describe('tokens.tradition keys are real corpus slugs', () => {
  it('drops the fictional keys that were never in the corpus', () => {
    for (const dead of ['vedanta', 'kabbalah', 'mysticism']) {
      expect(keys).not.toContain(dead);
    }
  });

  it('includes the major corpus traditions that were previously missing', () => {
    for (const real of [
      'neoplatonism', 'egyptian', 'greek_mystery', 'western_esoteric',
      'christian_mysticism', 'jewish_mysticism', 'zoroastrianism',
    ]) {
      expect(keys).toContain(real);
    }
  });

  it('covers the corpus v4 additions (previously fell back to grey)', () => {
    // SELECT DISTINCT tradition FROM corpus.chunks, 2026-07-10 — these
    // five arrived with the schema_version=4 corpus (todo:1282b2b5).
    for (const added of ['celtic', 'finnic', 'norse', 'shinto', 'upanishads']) {
      expect(keys).toContain(added);
    }
  });

  it('every key is a lowercase/underscored slug and maps to a hex color', () => {
    for (const [k, v] of Object.entries(tokens.tradition)) {
      expect(k).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
