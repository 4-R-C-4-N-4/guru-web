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
  },
  text: {
    primary:   '#d4cfc4',
    secondary: '#8a8578',
    muted:     '#5a5650',
    accent:    '#c4a35a',
    link:      '#7a9ec2',
  },
  border: {
    subtle: '#2a2a34',
    medium: '#3a3a48',
    accent: '#c4a35a33',
  },
  tradition: {
    gnosticism:  '#c2785a',
    kabbalah:    '#7a7ac2',
    hermeticism: '#c4a35a',
    neoplatonism:'#5a8ac2',
    vedanta:     '#c25a7a',
    buddhism:    '#5ac27a',
    mysticism:   '#a05ac2',
    sufism:      '#5ac2a0',
    taoism:      '#7ac27a',
  },
  tier: {
    verified: '#c4a35a',
    proposed: '#7a9ec2',
    inferred: '#5a5650',
  },
  font: {
    display: "'Cormorant Garamond', serif",
    mono:    "'IBM Plex Mono', monospace",
  },
} as const;

export type Tradition = keyof typeof tokens.tradition;
export type Tier      = keyof typeof tokens.tier;
