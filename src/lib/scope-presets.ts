/**
 * src/lib/scope-presets.ts
 *
 * Tradition-group presets for the scope picker. The corpus grew past 20
 * traditions and toggling them one at a time got tedious (user request,
 * 2026-07-17); presets pre-select texts in broad strokes.
 *
 * Presets are defined as tradition-slug lists, NOT a saved axis on the
 * corpus — corpus.traditions carries no era/region/family metadata, so
 * this grouping lives here as editorial curation. Membership is applied
 * against whatever traditions the catalog actually contains: a slug
 * listed here but absent from the corpus is silently ignored (presetState
 * counts only present members), and a new tradition with no preset simply
 * won't appear in any chip until added below.
 *
 * The axes are NOT mutually exclusive and members overlap freely across
 * (and within) axes — e.g. neoplatonism is Ancient + Western + Hermetic +
 * Platonic. Region is close to a partition except egyptian, which the user
 * chose to place in both Near Eastern and Indigenous. Era is assigned by
 * each tradition's textual core as represented in this corpus, so it's
 * lossy at the edges (christian_mysticism spans ~500–1500) — good enough
 * for a coarse pre-select, not a scholarly dating.
 *
 * Pure data + pure helpers so the apply/derive contract is unit-testable
 * in node with no DOM — same seam pattern as scope.ts.
 */

import { activeCount, type Catalog } from './scope';

export interface Preset {
  id: string;
  label: string;
  members: string[]; // tradition slugs (lowercased, underscored)
}

export interface PresetAxis {
  axis: string;
  presets: Preset[];
}

export const PRESET_AXES: PresetAxis[] = [
  {
    axis: 'Era',
    presets: [
      {
        id: 'ancient',
        label: 'Ancient',
        members: [
          'mesopotamian', 'egyptian', 'upanishads', 'zoroastrianism',
          'taoism', 'buddhism', 'greek_mystery', 'platonism',
          'neoplatonism', 'gnosticism', 'hermeticism', 'mandaean',
        ],
      },
      {
        id: 'medieval',
        label: 'Medieval',
        members: [
          'christian_mysticism', 'jewish_mysticism', 'sufism',
          'norse', 'celtic', 'shinto',
        ],
      },
      {
        id: 'modern',
        label: 'Modern',
        members: ['renaissance_hermeticism', 'western_esoteric', 'finnic'],
      },
    ],
  },
  {
    axis: 'Region',
    presets: [
      {
        id: 'western',
        label: 'Western',
        members: [
          'platonism', 'neoplatonism', 'greek_mystery', 'gnosticism',
          'hermeticism', 'christian_mysticism', 'renaissance_hermeticism',
          'western_esoteric',
        ],
      },
      {
        id: 'eastern',
        label: 'Eastern',
        members: ['buddhism', 'taoism', 'upanishads', 'shinto'],
      },
      {
        id: 'near_eastern',
        label: 'Near Eastern',
        members: [
          'egyptian', 'mesopotamian', 'zoroastrianism',
          'jewish_mysticism', 'sufism', 'mandaean',
        ],
      },
      {
        id: 'indigenous',
        label: 'Indigenous',
        members: ['finnic', 'celtic', 'norse', 'egyptian'],
      },
    ],
  },
  {
    axis: 'Current',
    presets: [
      {
        id: 'hermetic',
        label: 'Hermetic',
        members: [
          'hermeticism', 'renaissance_hermeticism', 'western_esoteric',
          'neoplatonism', 'gnosticism',
        ],
      },
      {
        id: 'platonic',
        label: 'Platonic',
        members: ['platonism', 'neoplatonism', 'greek_mystery'],
      },
      {
        id: 'abrahamic',
        label: 'Abrahamic',
        members: ['christian_mysticism', 'jewish_mysticism', 'sufism', 'mandaean'],
      },
    ],
  },
];

export type PresetState = 'on' | 'partial' | 'off';

/**
 * A preset's tri-state, derived from member texts present in the catalog.
 * 'on' = every member text is active, 'off' = none is (also the case when
 * no member is present), 'partial' = some are. Mirrors the tradition row's
 * own tri-state so a chip and its rows never contradict each other.
 */
export function presetState(catalog: Catalog, members: string[]): PresetState {
  let total = 0;
  let active = 0;
  for (const name of members) {
    const t = catalog[name];
    if (!t) continue;
    total += t.texts.length;
    active += activeCount(t);
  }
  if (total === 0 || active === 0) return 'off';
  if (active === total) return 'on';
  return 'partial';
}

/**
 * Set every member tradition's texts to `active`, leaving non-members
 * untouched. Off/partial chips turn members fully on; on chips turn them
 * fully off — same click semantics as toggleTradition, extended to a
 * group. Overlapping presets stay predictable because each apply is an
 * absolute set, not a relative flip.
 */
export function applyPreset(catalog: Catalog, members: string[], active: boolean): Catalog {
  const set = new Set(members);
  return Object.fromEntries(
    Object.entries(catalog).map(([name, t]) => [
      name,
      set.has(name) ? { ...t, texts: t.texts.map(x => ({ ...x, active })) } : t,
    ]),
  );
}
