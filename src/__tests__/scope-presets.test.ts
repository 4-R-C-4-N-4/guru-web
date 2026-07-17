/**
 * src/__tests__/scope-presets.test.ts
 *
 * Tradition-group presets for the scope picker (2026-07-17). Covers the
 * two pure seams the settings UI drives: presetState (chip tri-state) and
 * applyPreset (group toggle). Also guards that every member slug shipped
 * in PRESET_AXES is a real corpus tradition, since presets are curated by
 * hand and a typo would just render a dead chip.
 */
import { describe, it, expect } from 'vitest';
import { hydrateCatalog } from '@/lib/scope';
import { PRESET_AXES, presetState, applyPreset } from '@/lib/scope-presets';
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

describe('presetState', () => {
  it('off when no member text is active', () => {
    const c = applyPreset(hydrateCatalog(CORPUS, OPEN_PREFS), ['taoism', 'buddhism'], false);
    expect(presetState(c, ['taoism', 'buddhism'])).toBe('off');
  });

  it('on when every member text is active', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    expect(presetState(c, ['taoism', 'buddhism'])).toBe('on');
  });

  it('partial when some member texts are active', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    c.taoism.texts[1].active = false; // Zhuangzi off
    expect(presetState(c, ['taoism', 'buddhism'])).toBe('partial');
  });

  it('counts only members present in the catalog (absent slugs ignored)', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    // 'sufism' isn't in CORPUS — presence-filtered out, taoism decides.
    expect(presetState(c, ['taoism', 'sufism'])).toBe('on');
  });

  it('off when no member is present at all', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    expect(presetState(c, ['sufism', 'norse'])).toBe('off');
  });
});

describe('applyPreset', () => {
  it('turns member traditions on without touching non-members', () => {
    const c = applyPreset(hydrateCatalog(CORPUS, OPEN_PREFS), ['taoism', 'buddhism', 'platonism'], false);
    const next = applyPreset(c, ['taoism', 'buddhism'], true);
    expect(next.taoism.texts.every(t => t.active)).toBe(true);
    expect(next.buddhism.texts[0].active).toBe(true);
    expect(next.platonism.texts[0].active).toBe(false); // untouched
  });

  it('turns member traditions off', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    const next = applyPreset(c, ['taoism'], false);
    expect(next.taoism.texts.every(t => !t.active)).toBe(true);
    expect(next.buddhism.texts[0].active).toBe(true);
  });

  it('is an absolute set — re-applying on top of a partial fully fills it', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    c.taoism.texts[1].active = false; // partial
    const next = applyPreset(c, ['taoism'], true);
    expect(next.taoism.texts.every(t => t.active)).toBe(true);
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

  it('no preset is left with fewer than two members', () => {
    // The user dropped single-member presets deliberately (2026-07-17).
    for (const { presets } of PRESET_AXES) {
      for (const p of presets) expect(p.members.length).toBeGreaterThanOrEqual(2);
    }
  });
});
