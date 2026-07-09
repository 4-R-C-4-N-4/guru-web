// src/styles/tokens.ts
// Design tokens extracted from the Guru prototype.
// Every component should import from here — do not hard-code colours or fonts.

export const tokens = {
  bg: {
    deep:    '#0a0a0f',
    surface: '#111118',
    raised:  '#1a1a24',
    overlay: '#22222e',
    hover:   '#2a2a38',
    danger:  '#3a1a22',
  },
  text: {
    primary:   '#d4cfc4',
    secondary: '#8a8578',
    muted:     '#5a5650',
    accent:    '#c4a35a',
    link:      '#7a9ec2',
    error:     '#c25a7a',
    errorSoft: '#e8c8d0',
  },
  border: {
    subtle: '#2a2a34',
    medium: '#3a3a48',
    accent: '#c4a35a33',
    danger: '#c25a7a',
  },
  // App-wide tradition→hue map (homepage badges, citations, settings catalog,
  // provider chips). Keys MUST be corpus tradition slugs (lowercased,
  // underscored) so chunks/citations resolve a color instead of falling back
  // to grey — the source of truth is `SELECT DISTINCT tradition FROM chunks`
  // (see src/lib/corpus.ts). Ordered by corpus prominence (chunk count).
  tradition: {
    neoplatonism:            '#5a8ac2',
    egyptian:                '#c2b05a',
    taoism:                  '#7ac27a',
    greek_mystery:           '#9a8ac2',
    western_esoteric:        '#c25a9a',
    christian_mysticism:     '#a05ac2',
    jewish_mysticism:        '#7a7ac2',
    zoroastrianism:          '#c25a3a',
    gnosticism:              '#c2785a',
    renaissance_hermeticism: '#b07a3a',
    mandaean:                '#5ab0c2',
    hermeticism:             '#c4a35a',
    sufism:                  '#5ac2a0',
    platonism:               '#7a9ec2',
    buddhism:                '#d08a30',
    mesopotamian:            '#a85a3a',
  },
  tier: {
    verified: '#c4a35a',
    proposed: '#7a9ec2',
    inferred: '#5a5650',
    summary:  '#8a7fb0', // generated study apparatus (W5)
  },
  font: {
    display: "'Cormorant Garamond', serif",
    mono:    "'IBM Plex Mono', monospace",
  },
} as const;

export type Tradition = keyof typeof tokens.tradition;
export type Tier      = keyof typeof tokens.tier;
