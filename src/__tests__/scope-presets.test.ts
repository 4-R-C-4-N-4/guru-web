/**
 * src/__tests__/scope-presets.test.ts
 *
 * Tradition-group presets for the scope picker (2026-07-17). Presets are a
 * filter you build up: chips are grey until armed, and the scope is the
 * union of armed presets (none armed → full corpus). Covers the two pure
 * seams the settings UI drives — armedMembers (union) and scopeFromArmed
 * (union → catalog scope) — plus an integrity guard that every curated
 * member slug is a real corpus tradition.
 */
import { describe, it, expect } from 'vitest';
import { hydrateCatalog, activeCount } from '@/lib/scope';
import { PRESET_AXES, armedMembers, scopeFromArmed } from '@/lib/scope-presets';
import { tokens } from '@/styles/tokens';

const CORPUS = {
  taoism: {
    chunks: 50,
    text_items: [
      { id: 'ttc', label: 'Tao Te Ching', ids: ['ttc'] },
      { id: 'zz',  label: 'Zhuangzi',     ids: ['zz'] },
    ],
  },
  buddhism: {
    chunks: 30,
    text_items: [{ id: 'dhp', label: 'The Dhammapada', ids: ['dhp'] }],
  },
  platonism: {
    chunks: 20,
    text_items: [{ id: 'rep', label: 'Republic', ids: ['rep'] }],
  },
};

const OPEN_PREFS = { scopeMode: 'all', blockedTraditions: [], blockedTexts: [] };
const scopedNames = (c: ReturnType<typeof hydrateCatalog>) =>
  Object.keys(c).filter(n => activeCount(c[n]) > 0).sort();

describe('armedMembers', () => {
  it('unions the members of every armed preset', () => {
    // 'eastern' = buddhism/taoism/upanishads/shinto; 'platonic' adds platonism.
    const u = armedMembers(['eastern', 'platonic']);
    expect(u.has('taoism')).toBe(true);
    expect(u.has('buddhism')).toBe(true);
    expect(u.has('platonism')).toBe(true);
    expect(u.has('norse')).toBe(false);
  });

  it('skips unknown preset ids', () => {
    expect(armedMembers(['eastern', 'nope']).has('taoism')).toBe(true);
    expect([...armedMembers(['nope'])]).toEqual([]);
  });
});

describe('scopeFromArmed', () => {
  it('no preset armed → full corpus in scope', () => {
    const c = scopeFromArmed(hydrateCatalog(CORPUS, OPEN_PREFS), []);
    expect(scopedNames(c)).toEqual(['buddhism', 'platonism', 'taoism']);
  });

  it('one preset armed → only its present members are in scope', () => {
    // 'eastern' includes buddhism + taoism (and absent shinto/upanishads).
    const c = scopeFromArmed(hydrateCatalog(CORPUS, OPEN_PREFS), ['eastern']);
    expect(scopedNames(c)).toEqual(['buddhism', 'taoism']);
  });

  it('arming a second preset widens to the union', () => {
    const c = scopeFromArmed(hydrateCatalog(CORPUS, OPEN_PREFS), ['eastern', 'platonic']);
    expect(scopedNames(c)).toEqual(['buddhism', 'platonism', 'taoism']);
  });

  it('is an absolute set — fully fills every member tradition', () => {
    const c = scopeFromArmed(hydrateCatalog(CORPUS, OPEN_PREFS), ['eastern']);
    expect(c.taoism.texts.every(t => t.active)).toBe(true); // both texts on
    expect(c.platonism.texts.every(t => !t.active)).toBe(true); // out of scope
  });

  it('absent member slugs are harmless (no throw, ignored)', () => {
    // 'indigenous' = finnic/celtic/norse/egyptian, none present in CORPUS.
    const c = scopeFromArmed(hydrateCatalog(CORPUS, OPEN_PREFS), ['indigenous']);
    expect(scopedNames(c)).toEqual([]); // nothing in scope, but no error
  });
});

describe('PRESET_AXES integrity', () => {
  it('every member slug is a real tradition hue key', () => {
    const known = new Set(Object.keys(tokens.tradition));
    for (const { presets } of PRESET_AXES) {
      for (const p of presets) {
        for (const m of p.members) {
          expect(known, `${p.id} member "${m}"`).toContain(m);
        }
      }
    }
  });

  it('preset ids are unique across all axes', () => {
    const ids = PRESET_AXES.flatMap(a => a.presets.map(p => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no preset is left with fewer than two members', () => {
    // The user dropped single-member presets deliberately (2026-07-17).
    for (const { presets } of PRESET_AXES) {
      for (const p of presets) expect(p.members.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// Coverage contract — the future-proofing for a hand-curated list. A new
// tradition added to tokens.tradition but not assigned here fails one of
// these, naming the orphaned slug, instead of silently vanishing from the
// picker in production. See the MAINTENANCE note in scope-presets.ts.
describe('PRESET_AXES corpus coverage', () => {
  const known = Object.keys(tokens.tradition).sort();
  const membersOf = (axis: string) =>
    PRESET_AXES.find(a => a.axis === axis)!.presets.flatMap(p => p.members);

  it('Era partitions the corpus — every tradition in exactly one era', () => {
    const era = membersOf('Era');
    // Disjoint: no slug listed in two eras (would inflate the count).
    expect(era.length, 'a tradition is assigned to two eras').toBe(new Set(era).size);
    // Total: sorted-array compare so a failure names the missing/extra slug.
    expect([...new Set(era)].sort()).toEqual(known);
  });

  it('Region covers the corpus — every tradition in at least one region', () => {
    // A cover, not a partition (egyptian is deliberately in two regions),
    // so we only assert the union equals the full corpus.
    expect([...new Set(membersOf('Region'))].sort()).toEqual(known);
  });
});
