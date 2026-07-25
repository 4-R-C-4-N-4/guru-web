/**
 * src/__tests__/seo.test.ts
 *
 * chunkMetaDescription (todo:17621cef): passage-page meta descriptions must
 * sell the annotation layer (concepts, cross-tradition parallels) and must
 * never fall back to the passage body — that text is public-domain and
 * duplicated across the web, and chunks opening with translator apparatus
 * turned it into garbage SERP copy.
 */
import { describe, it, expect } from 'vitest';
import {
  chunkMetaDescription, thinTraditionRobots, THIN_TRADITION_MIN_PASSAGES,
} from '@/lib/seo';

const CHUNK = {
  section: 'Ch. 1',
  pos: 1,
  text_label: 'Tao Te Ching',
  tradition_label: 'Taoism',
  tradition: 'taoism',
};

const tag = (label: string) => ({ label });
const rel = (tradition: string, edge_type: 'PARALLELS' | 'CONTRASTS' = 'PARALLELS') =>
  ({ edge_type, tradition });

describe('chunkMetaDescription (todo:17621cef)', () => {
  it('leads with section, text and tradition, then concepts and partner traditions', () => {
    const desc = chunkMetaDescription(
      CHUNK,
      [tag('apophatic theology'), tag('wu wei')],
      [rel('christian_mysticism'), rel('buddhism')],
    );
    expect(desc).toBe(
      'Ch. 1 of Tao Te Ching (Taoism) — apophatic theology, wu wei; '
      + 'parallels in Christian Mysticism and Buddhism. Every connection cited.',
    );
  });

  it('caps concepts at three and partner traditions at two', () => {
    const desc = chunkMetaDescription(
      CHUNK,
      [tag('a'), tag('b'), tag('c'), tag('d')],
      [rel('buddhism'), rel('gnosticism'), rel('hermeticism')],
    );
    expect(desc).toContain('a, b, c;');
    expect(desc).not.toContain(', d');
    expect(desc).toContain('parallels in Buddhism and Gnosticism and beyond');
    expect(desc).not.toContain('Hermeticism');
  });

  it('drops same-tradition partners and counts parallels when none remain', () => {
    const desc = chunkMetaDescription(CHUNK, [], [rel('taoism'), rel('taoism')]);
    expect(desc).toBe('Ch. 1 of Tao Te Ching (Taoism) — 2 cross-tradition parallels. Every connection cited.');
  });

  it('uses the passage position when the chunk has no section label', () => {
    const desc = chunkMetaDescription({ ...CHUNK, section: null, pos: 7 }, [tag('emanation')], []);
    expect(desc).toMatch(/^Passage 7 of Tao Te Ching \(Taoism\) — emanation\./);
  });

  it('falls back to library boilerplate — never the body — when unannotated', () => {
    const desc = chunkMetaDescription(CHUNK, [], []);
    expect(desc).toBe(
      'Ch. 1 of Tao Te Ching (Taoism) — read passage by passage with concept '
      + "tags and cross-tradition parallels in Guru's source library.",
    );
  });

  it('emits a single line, truncated at a word boundary under the cap', () => {
    const desc = chunkMetaDescription(
      { ...CHUNK, section: 'A\nvery\nlong   section'.repeat(3) },
      [tag('x'.repeat(120)), tag('y'.repeat(120))],
      [],
    );
    expect(desc).not.toMatch(/\n/);
    expect(desc).not.toMatch(/ {2}/);
    expect(desc.length).toBeLessThanOrEqual(220);
    expect(desc.endsWith('…')).toBe(true);
  });
});

describe('thinTraditionRobots (todo:17621cef)', () => {
  it('noindex-follows tradition pages below the passage threshold', () => {
    expect(thinTraditionRobots(1)).toEqual({ index: false, follow: true });
    expect(thinTraditionRobots(THIN_TRADITION_MIN_PASSAGES - 1))
      .toEqual({ index: false, follow: true });
  });

  it('leaves substantial tradition pages indexable (no directive at all)', () => {
    expect(thinTraditionRobots(THIN_TRADITION_MIN_PASSAGES)).toBeUndefined();
    expect(thinTraditionRobots(805)).toBeUndefined();
  });
});
