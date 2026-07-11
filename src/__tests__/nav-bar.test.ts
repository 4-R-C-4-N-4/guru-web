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

  it('reads payment_state from /api/quota and renders past-due banner (todo:33d44563)', () => {
    // The /api/quota fetch must surface payment_state into a state setter
    // and a role="alert" banner must render conditional on past_due. The
    // assertions are intentionally loose on the type annotation: a future
    // refactor that narrows the type to e.g. `'past_due' | null` is fine
    // and shouldn't break this guard.
    expect(SRC).toMatch(/\bpayment_state\b/);
    expect(SRC).toMatch(/setPaymentState/);
    expect(SRC).toMatch(/paymentState\s*===\s*['"]past_due['"]/);
    expect(SRC).toMatch(/role="alert"/);
    // The banner must offer a path to /account so the user can update
    // their card via the Stripe customer portal.
    expect(SRC).toMatch(/router\.push\(['"]\/account['"]\)/);
  });

  it('mobile menu surfaces Account even though the slim desktop bar dropped it (todo:bddd1603, todo:063efee7)', () => {
    // Since the header rework the desktop bar is 4 items (Account lives in
    // the avatar menu), but mobile has no avatar — MOBILE_MENU_ITEMS must
    // append Account or the only mobile path to it is typing the URL.
    expect(SRC).toMatch(/MOBILE_MENU_ITEMS\s*=\s*\[\s*\.\.\.NAV_ITEMS,\s*\{\s*href:\s*['"]\/account['"]\s*,\s*label:\s*['"]Account['"]/);
    // And the mobile dropdown must actually map MOBILE_MENU_ITEMS rather
    // than duplicating a hand-rolled subset (which is how this drift happens).
    expect(SRC).toMatch(/mobile && menuOpen[\s\S]{0,400}MOBILE_MENU_ITEMS\.map/);
  });

  it('nav verb matches the send button: Ask, not Query (todo:063efee7)', () => {
    expect(SRC).toMatch(/href:\s*['"]\/chat['"]\s*,\s*label:\s*['"]Ask['"]/);
    expect(SRC).not.toMatch(/label:\s*['"]Query['"]/);
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
