/**
 * src/__tests__/tokens-css-vars.test.ts
 *
 * tokensToCssVars (todo:ee098434) bridges tokens.ts → CSS custom
 * properties on <html>. globals.css primitives depend on these exact
 * names; a rename or dropped group breaks styling silently, so pin the
 * contract here.
 */
import { describe, it, expect } from 'vitest';
import { tokens, tokensToCssVars } from '@/styles/tokens';

describe('tokensToCssVars', () => {
  const vars = tokensToCssVars();

  it('emits every non-font token as --group-name', () => {
    expect(vars['--bg-deep']).toBe(tokens.bg.deep);
    expect(vars['--text-accent']).toBe(tokens.text.accent);
    expect(vars['--border-subtle']).toBe(tokens.border.subtle);
    expect(vars['--tier-verified']).toBe(tokens.tier.verified);
  });

  it('kebab-cases underscored tradition slugs', () => {
    expect(vars['--tradition-greek-mystery']).toBe(tokens.tradition.greek_mystery);
    expect(vars['--tradition-christian-mysticism']).toBe(tokens.tradition.christian_mysticism);
  });

  it('never shadows the next/font variables', () => {
    // next/font sets --font-display/--font-mono with size-adjusted
    // fallback faces; an inline override from tokens would drop those.
    expect(Object.keys(vars).filter(k => k.startsWith('--font'))).toEqual([]);
  });

  it('emits only string values (CSSProperties-safe)', () => {
    for (const v of Object.values(vars)) expect(typeof v).toBe('string');
  });
});
