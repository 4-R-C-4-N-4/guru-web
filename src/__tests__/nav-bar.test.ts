/**
 * src/__tests__/nav-bar.test.ts
 *
 * Source-level guards for the nav-bar avatar dropdown (todo:0bc47bac).
 * The avatar must be interactive and provide at least a sign-out path;
 * regression catches a future refactor that drops the click handler or
 * forgets to wire signOut.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../components/nav-bar.tsx'), 'utf8');

describe('nav-bar avatar dropdown', () => {
  it('imports useClerk for signOut', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*\buseClerk\b[^}]*\}\s*from\s*['"]@clerk\/nextjs['"]/);
  });

  it('calls signOut() somewhere', () => {
    expect(SRC).toMatch(/signOut\s*\(/);
  });

  it('avatar has an onClick handler (no longer a static div)', () => {
    expect(SRC).toMatch(/aria-label="Account menu"/);
    expect(SRC).toMatch(/onClick=\{\(\)\s*=>\s*setAvatarOpen/);
  });

  it('dropdown exposes Account + Sign out menuitems', () => {
    // At least one role="menuitem" exists, and both labels are present.
    expect(SRC).toMatch(/role="menuitem"/);
    expect(SRC).toMatch(/>Account</);
    expect(SRC).toMatch(/>Sign out</);
  });

  it('mobile hamburger menu also has a Sign out item', () => {
    // Mobile menu uses NAV_ITEMS.map + a separate Sign out button. Just
    // assert there are at least two "Sign out" labels in the file
    // (desktop dropdown + mobile menu).
    const matches = SRC.match(/Sign out/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('nav-bar avatar label fallback (todo:11310d03)', () => {
  it("does not fall back to the literal '?' character", () => {
    // The old fallback was `... .join('') || '?';`. Either an empty-string
    // sentinel (rendered as the SVG glyph) or an email-letter is fine —
    // a literal '?' is not.
    expect(SRC).not.toMatch(/\|\|\s*['"]\?['"]/);
  });

  it('reads primaryEmailAddress for the email-letter fallback', () => {
    expect(SRC).toMatch(/primaryEmailAddress/);
  });

  it('renders an SVG person glyph when no label is available', () => {
    // The render branch must include an <svg> with aria-hidden so the
    // button still announces "Account menu" via aria-label and doesn't
    // double-announce the decorative icon.
    expect(SRC).toMatch(/<svg[^>]*aria-hidden/);
    // And the label must be conditionally rendered (string OR svg).
    expect(SRC).toMatch(/avatarLabel\s*\?\?/);
  });
});
