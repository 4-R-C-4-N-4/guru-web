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
  id, text_id: `${id}-text`, tradition, text_name: text, section: 'I.1', translator: null, tier: 'verified', body, token_count: 6,
});

const SNAP: AtlasSnapshot = {
  generatedAt: '2026-06-06T00:00:00Z',
  schemaVersion: '3',
  headline: { traditions: 16, concepts: 95, families: 28, parallelsVerified: 4252, parallelsProposed: 382, contrasts: 8 },
  documentLayer: { works: 52, dossiers: 52, summaryNodesL1: 214, summaryNodesL2: 52 },
  traditionMatrix: [{ a: 'neoplatonism', b: 'taoism', parallels: 322 }],
  centrality: [{ tradition: 'neoplatonism', chunks: 828, parallelDegree: 2500, partnerTraditions: 13, parallelsPer100Chunks: 301.9 }],
  bridgeConcepts: [{ label: 'Apophatic Theology', domain: 'theology', family: 'Divine Nature', traditions: 15, mentions: 646 }],
  familyBridges: [{ id: 'theology.divine_nature', label: 'Divine Nature', domain: 'theology', traditions: 15, concepts: 5, mentions: 2510 }],
  hierarchy: [{ domain: 'theology', families: [{ id: 'theology.divine_nature', label: 'Divine Nature', concepts: ['Apophatic Theology', 'Divine Hiddenness'] }] }],
  longRangeCases: [{
    a: 'neoplatonism', b: 'taoism', parallels: 322,
    exemplars: [{ a: chunk('a1', 'neoplatonism', 'Enneads', 'The One overflows into being.'), b: chunk('b1', 'taoism', 'Tao Te Ching', 'The Tao that can be named.') }],
  }],
  contrasts: [{
    a: chunk('c1', 'zoroastrianism', 'Gathas', 'Two primal spirits.'),
    b: chunk('c2', 'neoplatonism', 'Enneads', 'The One is beyond duality.'),
    annotation: 'A asserts an irreducible dual; B asserts an undivided One.',
  }],
  dossierCapsules: [{
    work_id: 'enneads', work_label: 'The Enneads', tradition: 'neoplatonism',
    summary: 'Plotinus systematized late-antique Platonism.', context: 'Third-century Rome.',
    themes: ['Emanation', 'The One'],
    text_ids: ['a1-text', 'c2-text'],
  }],
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
  it('marks work dossiers as framing apparatus, never citable or a source of numbers', () => {
    expect(sys).toMatch(/WORK DOSSIERS DISCIPLINE/);
    expect(sys.toLowerCase()).toMatch(/not evidence/);
    expect(sys.toLowerCase()).toMatch(/never quote dossier text as if it were a primary passage/);
    expect(sys.toLowerCase()).toMatch(/never derive a number/);
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
    // The hierarchy is expressed: family-level bridges, concept shown in its
    // family, and the full domain → family → concept map.
    expect(prompt).toContain('Divine Nature (theology, 5 concepts): 15 traditions');
    expect(prompt).toMatch(/Apophatic Theology \(theology › Divine Nature\)/);
    expect(prompt).toMatch(/Full concept map[\s\S]*theology[\s\S]*Divine Nature: Apophatic Theology, Divine Hiddenness/);
    // Contrasts are itemized with their curated annotation, not just counted.
    expect(prompt).toMatch(/Explicit contrasts/);
    expect(prompt).toMatch(/zoroastrianism \(Gathas\) ⟷ neoplatonism \(Enneads\): A asserts an irreducible dual/);
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
  it('renders the document-knowledge layer line in FACTS', () => {
    expect(prompt).toMatch(/Document-knowledge layer: 52 works, 52 with curated dossiers, 214 section summaries \+ 52 whole-work summaries/);
  });
  it('renders WORK DOSSIERS as a distinct block with capsule content', () => {
    expect(prompt).toMatch(/WORK DOSSIERS \(curated capsules/);
    expect(prompt).toContain('— The Enneads (neoplatonism) [themes: Emanation, The One]');
    expect(prompt).toContain('Plotinus systematized late-antique Platonism.');
    expect(prompt).toContain('Context: Third-century Rome.');
  });
  it('drops capsules whose works are no longer quoted after passage fitting', () => {
    const snap: AtlasSnapshot = {
      ...SNAP,
      dossierCapsules: [
        ...SNAP.dossierCapsules,
        // A work whose only passage never made it into SOURCE PASSAGES.
        {
          work_id: 'ghost', work_label: 'The Ghost Work', tradition: 'taoism',
          summary: 'Never quoted.', context: 'Nowhere.', themes: [],
          text_ids: ['zz-text'],
        },
        // Legacy capsule without text_ids (snapshot stored before the field
        // existed) — unverifiable, so it stays.
        {
          work_id: 'legacy', work_label: 'The Legacy Work', tradition: 'taoism',
          summary: 'From an older snapshot.', context: 'Unknown.', themes: [],
        } as unknown as AtlasSnapshot['dossierCapsules'][number],
      ],
    };
    const p = buildAtlasPrompt(snap);
    expect(p).toContain('— The Enneads (neoplatonism)');
    expect(p).not.toContain('The Ghost Work');
    expect(p).toContain('— The Legacy Work (taoism)');
  });
  it('omits the dossier block and layer line on a pre-v4/undossiered snapshot', () => {
    const old = { ...SNAP, documentLayer: undefined, dossierCapsules: undefined } as unknown as AtlasSnapshot;
    const p = buildAtlasPrompt(old);
    expect(p).not.toMatch(/Document-knowledge layer/);
    expect(p).not.toMatch(/WORK DOSSIERS/);
    expect(p).toMatch(/SOURCE PASSAGES:/); // the rest still renders
  });
});
