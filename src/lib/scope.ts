/**
 * src/lib/scope.ts
 *
 * Corpus-scope state seams for the settings page (todo:195d1b2f).
 * Pure functions so the persistence contract is testable in the node
 * environment (no DOM) — same pattern as seed-form's buildScopePayload.
 *
 * Regression anchor: the pre-redesign settings page rendered per-text
 * checkboxes but only saved tradition-level blocks — partial selections
 * silently vanished on reload even though prefs + retriever support
 * blockedTexts end to end (graph.ts filters on text_id).
 */

export interface TextState {
  label: string;
  ids: string[];      // every member text_id behind this display label
  active: boolean;
}
export interface TraditionState {
  chunks: number;     // corpus weight — drives the spectrum segment width
  texts: TextState[];
}
export type Catalog = Record<string, TraditionState>;

export function activeCount(t: TraditionState): number {
  return t.texts.filter(x => x.active).length;
}

export interface ScopeTotals {
  texts: number;
  activeTexts: number;
  traditions: number;
  activeTraditions: number;
}

/**
 * Aggregate counts for the scope summary line. Shared by the settings
 * header and the chat footer so the two can never disagree.
 */
export function scopeTotals(catalog: Catalog): ScopeTotals {
  const all = Object.values(catalog);
  return {
    texts:            all.reduce((n, t) => n + t.texts.length, 0),
    activeTexts:      all.reduce((n, t) => n + activeCount(t), 0),
    traditions:       all.length,
    activeTraditions: all.filter(t => activeCount(t) > 0).length,
  };
}

/**
 * Corpus catalog + saved prefs → checkbox state. A label is blocked when
 * its tradition is, or when ANY of its member ids appears in
 * blockedTexts; buildScopeSave writes all members, so "any" and "all"
 * agree on data this page wrote.
 */
export function hydrateCatalog(
  corpusTraditions: Record<string, {
    text_items: { id: string; label: string; ids: string[] }[];
    chunks: number;
  }>,
  prefs: { scopeMode: string; blockedTraditions: string[]; blockedTexts: string[] },
): Catalog {
  const blacklist   = prefs.scopeMode === 'blacklist';
  const blockedTrad = new Set(blacklist ? prefs.blockedTraditions : []);
  const blockedIds  = new Set(blacklist ? prefs.blockedTexts : []);
  const next: Catalog = {};
  for (const [name, data] of Object.entries(corpusTraditions)) {
    const tradBlocked = blockedTrad.has(name.toLowerCase());
    next[name] = {
      chunks: data.chunks,
      texts: data.text_items.map(item => ({
        label: item.label,
        ids: item.ids,
        active: !tradBlocked && !item.ids.some(id => blockedIds.has(id)),
      })),
    };
  }
  return next;
}

/**
 * Checkbox state → PUT /api/preferences payload. Fully blocked traditions
 * go to blockedTraditions (and don't repeat their text ids — the tradition
 * filter already excludes them in retrieval); partially blocked ones
 * contribute EVERY member id of each unchecked label to blockedTexts —
 * grouped works must block all members or most of the work stays
 * retrievable.
 */
export function buildScopeSave(catalog: Catalog): {
  scopeMode: 'blacklist';
  blockedTraditions: string[];
  blockedTexts: string[];
} {
  const blockedTraditions: string[] = [];
  const blockedTexts: string[] = [];
  for (const [name, t] of Object.entries(catalog)) {
    if (activeCount(t) === 0) {
      blockedTraditions.push(name.toLowerCase());
    } else {
      for (const x of t.texts) if (!x.active) blockedTexts.push(...x.ids);
    }
  }
  return { scopeMode: 'blacklist', blockedTraditions, blockedTexts };
}
