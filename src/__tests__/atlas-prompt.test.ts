/**
 * src/__tests__/atlas-prompt.test.ts
 *
 * The atlas prompt is where honesty + grounding are enforced. The system prompt
 * must mandate a methodology-forward opening and forbid inventing statistics;
 * the user prompt must carry the snapshot's numbers verbatim in a FACTS block
 * and the exemplar passages as SOURCE PASSAGES in the citation format.
 */
import { describe, it, expect } from 'vitest';
import { getAtlasSystemPrompt, buildAtlasPrompt } from '@/lib/prompt';
import type { AtlasSnapshot, AtlasChunk } from '@/lib/atlas';

const chunk = (id: string, tradition: string, text: string, body: string): AtlasChunk => ({
  id, tradition, text_name: text, section: 'I.1', translator: null, tier: 'verified', body, token_count: 6,
});

const SNAP: AtlasSnapshot = {
  generatedAt: '2026-06-06T00:00:00Z',
  schemaVersion: '3',
  headline: { traditions: 16, concepts: 95, families: 28, parallelsVerified: 4252, parallelsProposed: 382, contrasts: 8 },
  traditionMatrix: [{ a: 'neoplatonism', b: 'taoism', parallels: 322 }],
  centrality: [{ tradition: 'neoplatonism', chunks: 828, parallelDegree: 2500, partnerTraditions: 13, parallelsPer100Chunks: 301.9 }],
  bridgeConcepts: [{ label: 'Apophatic Theology', domain: 'theology', traditions: 15, mentions: 646 }],
  longRangeCases: [{
    a: 'neoplatonism', b: 'taoism', parallels: 322,
    exemplars: [{ a: chunk('a1', 'neoplatonism', 'Enneads', 'The One overflows into being.'), b: chunk('b1', 'taoism', 'Tao Te Ching', 'The Tao that can be named.') }],
  }],
  contrasts: [{ a: chunk('c1', 'zoroastrianism', 'Gathas', 'Two primal spirits.'), b: chunk('c2', 'neoplatonism', 'Enneads', 'The One is beyond duality.') }],
};

describe('getAtlasSystemPrompt', () => {
  const sys = getAtlasSystemPrompt();
  it('mandates a methodology-forward opening', () => {
    expect(sys).toMatch(/METHODOLOGY/);
    expect(sys.toLowerCase()).toMatch(/language model/);
    expect(sys.toLowerCase()).toMatch(/verified/);
    expect(sys.toLowerCase()).toMatch(/curated/);
  });
  it('forbids inventing statistics', () => {
    expect(sys).toMatch(/FACTS DISCIPLINE/);
    expect(sys.toLowerCase()).toMatch(/must come from the facts/);
  });
  it('keeps the parseable TITLE/DEK/CITATIONS output contract', () => {
    expect(sys).toMatch(/TITLE:/);
    expect(sys).toMatch(/DEK:/);
    expect(sys).toMatch(/CITATIONS:/);
  });
});

describe('buildAtlasPrompt', () => {
  const prompt = buildAtlasPrompt(SNAP);
  it('emits a FACTS block with the snapshot numbers verbatim', () => {
    expect(prompt).toMatch(/FACTS/);
    expect(prompt).toContain('4252 verified');
    expect(prompt).toContain('neoplatonism ↔ taoism: 322');
    expect(prompt).toContain('301.9 parallels/100 chunks'); // the normalized figure
    expect(prompt).toContain('Apophatic Theology');
  });
  it('emits SOURCE PASSAGES with exemplar + contrast bodies in the citation header format', () => {
    expect(prompt).toMatch(/SOURCE PASSAGES:/);
    expect(prompt).toContain('The One overflows into being.');
    expect(prompt).toContain('The Tao that can be named.');
    expect(prompt).toContain('Two primal spirits.'); // a contrast passage
    expect(prompt).toMatch(/neoplatonism \| Enneads \| I\.1/);
    // Tier is explicit (copyable into CITATIONS), not just a glyph.
    expect(prompt).toMatch(/\| Enneads \| I\.1 \| TIER: verified/);
  });
});
