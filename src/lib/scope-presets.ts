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

import type { Catalog } from './scope';

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

const ALL_PRESETS: Preset[] = PRESET_AXES.flatMap(a => a.presets);
const BY_ID: Record<string, Preset> = Object.fromEntries(ALL_PRESETS.map(p => [p.id, p]));

/**
 * The union of every member tradition across the armed presets. Unknown
 * ids are skipped; the result may include slugs absent from any given
 * catalog (scopeFromArmed only reads it as a membership test, so absent
 * slugs are harmless).
 */
export function armedMembers(armed: Iterable<string>): Set<string> {
  const union = new Set<string>();
  for (const id of armed) {
    const p = BY_ID[id];
    if (p) for (const m of p.members) union.add(m);
  }
  return union;
}

/**
 * Compute the catalog scope from the armed preset ids. Presets act as an
 * additive filter you build up: a tradition is in scope iff it belongs to
 * at least one armed preset, everything else is out. NO preset armed means
 * the full corpus (the picker isn't constraining anything) — not an empty
 * scope. This is an absolute set at tradition granularity, so partial
 * per-text selections don't survive a chip click, by design: chips are the
 * broad-strokes control, the rows below are the fine-tuning.
 */
export function scopeFromArmed(catalog: Catalog, armed: Iterable<string>): Catalog {
  const ids = [...armed];
  const union = ids.length === 0 ? null : armedMembers(ids);
  const inScope = union === null ? () => true : (name: string) => union.has(name);
  return Object.fromEntries(
    Object.entries(catalog).map(([name, t]) => [
      name,
      { ...t, texts: t.texts.map(x => ({ ...x, active: inScope(name) })) },
    ]),
  );
}
