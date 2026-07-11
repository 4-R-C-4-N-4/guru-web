/**
 * src/__tests__/settings-scope.test.ts
 *
 * Scope persistence seams for the redesigned settings page
 * (todo:195d1b2f). Regression anchor: the old page rendered per-text
 * checkboxes but only saved tradition-level blocks — partial selections
 * silently vanished on reload. buildScopeSave must persist blockedTexts
 * and hydrateCatalog must restore them, round-tripping exactly.
 */
import { describe, it, expect } from 'vitest';
import { hydrateCatalog, buildScopeSave, scopeTotals } from '@/lib/scope';

const CORPUS = {
  Taoism: {
    chunks: 50,
    text_items: [
      { id: 'ttc', label: 'Tao Te Ching', ids: ['ttc'] },
      { id: 'zz',  label: 'Zhuangzi',     ids: ['zz'] },
    ],
  },
  Buddhism: {
    chunks: 30,
    // Grouped work: one label, three member ids.
    text_items: [
      { id: 'dhp.1', label: 'The Dhammapada', ids: ['dhp.1', 'dhp.2', 'dhp.3'] },
    ],
  },
};

const OPEN_PREFS = { scopeMode: 'all', blockedTraditions: [], blockedTexts: [] };

describe('hydrateCatalog', () => {
  it('marks everything active when nothing is blocked', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    expect(c.Taoism.texts.every(t => t.active)).toBe(true);
    expect(c.Buddhism.texts[0].active).toBe(true);
    expect(c.Taoism.chunks).toBe(50);
  });

  it('restores tradition-level blocks case-insensitively', () => {
    const c = hydrateCatalog(CORPUS, {
      scopeMode: 'blacklist', blockedTraditions: ['taoism'], blockedTexts: [],
    });
    expect(c.Taoism.texts.every(t => !t.active)).toBe(true);
    expect(c.Buddhism.texts[0].active).toBe(true);
  });

  it('restores per-text blocks — ANY blocked member id blocks the label', () => {
    const c = hydrateCatalog(CORPUS, {
      scopeMode: 'blacklist', blockedTraditions: [], blockedTexts: ['dhp.2'],
    });
    expect(c.Buddhism.texts[0].active).toBe(false);
    expect(c.Taoism.texts.every(t => t.active)).toBe(true);
  });

  it('ignores blocked lists outside blacklist mode', () => {
    const c = hydrateCatalog(CORPUS, {
      scopeMode: 'all', blockedTraditions: ['taoism'], blockedTexts: ['ttc'],
    });
    expect(c.Taoism.texts.every(t => t.active)).toBe(true);
  });
});

describe('buildScopeSave', () => {
  it('fully unchecked tradition → blockedTraditions, ids NOT repeated in blockedTexts', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    c.Taoism.texts.forEach(t => { t.active = false; });
    const save = buildScopeSave(c);
    expect(save.scopeMode).toBe('blacklist');
    expect(save.blockedTraditions).toEqual(['taoism']);
    expect(save.blockedTexts).toEqual([]);
  });

  it('partially unchecked tradition → EVERY member id of the label persists', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    c.Buddhism.texts[0].active = false;
    // Buddhism still "active"? No — its only text is off, so it goes to
    // blockedTraditions. Use Taoism for the partial case instead.
    c.Buddhism.texts[0].active = true;
    c.Taoism.texts[1].active = false; // Zhuangzi off, Tao Te Ching on
    const save = buildScopeSave(c);
    expect(save.blockedTraditions).toEqual([]);
    expect(save.blockedTexts).toEqual(['zz']);
  });

  it('grouped work unchecked while a sibling stays on → all member ids persist', () => {
    const corpus = {
      Buddhism: {
        chunks: 40,
        text_items: [
          { id: 'dhp.1', label: 'The Dhammapada', ids: ['dhp.1', 'dhp.2', 'dhp.3'] },
          { id: 'hs',    label: 'The Heart Sutra', ids: ['hs'] },
        ],
      },
    };
    const c = hydrateCatalog(corpus, OPEN_PREFS);
    c.Buddhism.texts[0].active = false;
    const save = buildScopeSave(c);
    expect(save.blockedTraditions).toEqual([]);
    expect(save.blockedTexts).toEqual(['dhp.1', 'dhp.2', 'dhp.3']);
  });

  it('round-trips: hydrate(save(state)) === state', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    c.Taoism.texts[0].active = false;   // partial
    const rehydrated = hydrateCatalog(CORPUS, buildScopeSave(c));
    expect(rehydrated).toEqual(c);
  });

  it('everything active → empty block lists (open scope)', () => {
    const save = buildScopeSave(hydrateCatalog(CORPUS, OPEN_PREFS));
    expect(save.blockedTraditions).toEqual([]);
    expect(save.blockedTexts).toEqual([]);
  });
});

describe('scopeTotals', () => {
  // Shared by the settings header and the chat footer so the two lines
  // can never disagree (review follow-up on todo:2c65c512).
  it('counts texts and traditions, active and total', () => {
    const c = hydrateCatalog(CORPUS, OPEN_PREFS);
    c.Taoism.texts[1].active = false;   // Zhuangzi off — Taoism partial
    expect(scopeTotals(c)).toEqual({
      texts: 3, activeTexts: 2, traditions: 2, activeTraditions: 2,
    });
  });

  it('a fully blocked tradition leaves activeTraditions', () => {
    const c = hydrateCatalog(CORPUS, {
      scopeMode: 'blacklist', blockedTraditions: ['taoism'], blockedTexts: [],
    });
    expect(scopeTotals(c)).toEqual({
      texts: 3, activeTexts: 1, traditions: 2, activeTraditions: 1,
    });
  });

  it('empty catalog → all zeros (no fallback constants)', () => {
    expect(scopeTotals({})).toEqual({
      texts: 0, activeTexts: 0, traditions: 0, activeTraditions: 0,
    });
  });
});
