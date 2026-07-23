/**
 * src/__tests__/read-path.test.ts
 *
 * The chunk-id ↔ reader-path mapping is the contract every citation link
 * and reader route relies on. Chunk ids are `<tradition>.<textId>.<NNN>`;
 * anything else (summary nodes, malformed/legacy ids) must map to null so
 * link emitters degrade to unlinked rather than emitting a broken href.
 */
import { describe, it, expect } from 'vitest';
import { chunkIdToPath, pathToChunkId, citationHref, sectionFormatLabel } from '@/lib/read-path';

describe('chunkIdToPath', () => {
  it('maps a 3-part chunk id to its reader path, preserving padding', () => {
    expect(chunkIdToPath('gnosticism.gospel-of-thomas.001')).toBe('/read/gnosticism/gospel-of-thomas/001');
  });

  it('round-trips through pathToChunkId', () => {
    const id = 'taoism.tao-te-ching-legge.048';
    expect(pathToChunkId('taoism', 'tao-te-ching-legge', '048')).toBe(id);
    expect(chunkIdToPath(id)).toBe('/read/taoism/tao-te-ching-legge/048');
  });

  it('returns null for summary ids, wrong part counts and empty parts', () => {
    expect(chunkIdToPath('sum:agrippa-natural-magic')).toBeNull();
    expect(chunkIdToPath('tradition.text')).toBeNull();
    expect(chunkIdToPath('a.b.c.d')).toBeNull();
    expect(chunkIdToPath('a..003')).toBeNull();
    expect(chunkIdToPath('')).toBeNull();
  });
});

describe('citationHref', () => {
  it('routes chunk ids to the chunk page and sum: ids to the summary page', () => {
    expect(citationHref('buddhism.dhammapada-chapter-01.004')).toBe('/read/buddhism/dhammapada-chapter-01/004');
    expect(citationHref('sum:agrippa-natural-magic-ch-02:chapter-ii')).toBe(
      `/read/summary/${encodeURIComponent('sum:agrippa-natural-magic-ch-02:chapter-ii')}`,
    );
  });

  it('returns null for missing or unmappable ids', () => {
    expect(citationHref(undefined)).toBeNull();
    expect(citationHref(null)).toBeNull();
    expect(citationHref('not-a-chunk')).toBeNull();
  });
});

describe('sectionFormatLabel', () => {
  it('humanizes known formats and falls back to Sections', () => {
    expect(sectionFormatLabel('logion')).toBe('Logia');
    expect(sectionFormatLabel('rune')).toBe('Runes');
    expect(sectionFormatLabel(null)).toBe('Sections');
    expect(sectionFormatLabel('mystery_format')).toBe('Sections');
  });
});
