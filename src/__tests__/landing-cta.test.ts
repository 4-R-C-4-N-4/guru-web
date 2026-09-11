/**
 * src/__tests__/landing-cta.test.ts
 *
 * Source-level guard for the landing page's primary CTA + the shared
 * guest-funnel auth links (todo:f138c9ad, PR #140 review).
 *
 * The "Begin" button used to point at /sign-up (forced auth before seeing
 * anything). Then it became "Try it free" → /ask. Now the primary path is the
 * live ask composer embedded directly in the hero (headingless <AskView>), so
 * a signed-out visitor asks one real question on / with no click-through and
 * gets a streamed answer before the signup wall.
 *
 * Every "Sign in" / "Create account" affordance a guest who HAS asked might
 * click — the /ask header, the signup wall, and the homepage hero link once a
 * question has been asked there — must carry the same redirect_url=/ask?continue=1
 * return anchor, or that question is orphaned (GuestConvert never fires). The
 * homepage link is the one conditional case: before a question is asked it is a
 * plain returning-user /sign-in (no anchor, no spurious restore flash — review
 * #1). That anchor lives once in @/lib/funnel-links; these tests pin the single
 * source and its consumers.
 *
 * Behaviour isn't testable without Clerk + Next runtime, so we assert the
 * shared link values (runtime) + that each surface imports them (source).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GUEST_RETURN_TO, SIGN_IN_HREF, SIGN_UP_HREF } from '@/lib/funnel-links';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const LANDING_SRC    = read('../components/landing.tsx');
const ASK_LAYOUT_SRC = read('../app/ask/layout.tsx');
const GUEST_WALL_SRC = read('../components/guest-wall.tsx');

const importsFunnelLinks = (src: string) =>
  /import\s*\{[^}]*\bSIGN_IN_HREF\b[^}]*\}\s*from\s*['"]@\/lib\/funnel-links['"]/.test(src);

describe('Landing primary CTA (todo:f138c9ad)', () => {
  it('embeds the ask composer directly (headingless AskView), not a click-through', () => {
    expect(LANDING_SRC).toMatch(/import\s+AskView\s+from\s+['"]@\/components\/ask-view['"]/);
    expect(LANDING_SRC).toContain('<AskView showHeading={false}');
    // The old click-through button is gone — the composer IS the CTA.
    expect(LANDING_SRC).not.toMatch(/>Try it free<\/Link>/);
  });

  it('its "Sign in" link carries the return anchor ONLY once a guest has asked', () => {
    // PR #140 review #1 cuts both ways, so the href is conditional:
    //   • asked here → SIGN_IN_HREF (/ask?continue=1) so GuestConvert adopts
    //     the question after auth — a bare /sign-in would orphan it;
    //   • never asked → plain /sign-in → Clerk fallback (/chat) — carrying the
    //     anchor unconditionally flashed "Restoring your conversation…" + fired
    //     a needless convert POST at every returning user.
    // The gate is AskView's onGuestAsked callback lifted into hero state.
    expect(importsFunnelLinks(LANDING_SRC)).toBe(true);
    expect(LANDING_SRC).toContain('onGuestAsked={() => setHasAsked(true)}');
    expect(LANDING_SRC).toMatch(/href=\{hasAsked \? SIGN_IN_HREF : '\/sign-in'\}/);
    // Label is the umbrella "Sign in" (Clerk's card offers sign-up beneath it),
    // not the returning-user-only "Already have an account?" framing.
    expect(LANDING_SRC).toContain('>Sign in</Link>');
    expect(LANDING_SRC).not.toContain('Already have an account?');
  });

  it('no longer renders a Begin button routing to /sign-up', () => {
    expect(LANDING_SRC).not.toMatch(/href="\/sign-up"/);
    // Pin the actual markup, not the bare word (which could appear in prose
    // like "Beginner" and fail for an unrelated reason).
    expect(LANDING_SRC).not.toMatch(/>Begin<\/Link>/);
  });
});

describe('Guest-funnel auth links single source (@/lib/funnel-links, PR #140)', () => {
  it('defines the /ask?continue=1 return anchor and hrefs that carry it', () => {
    expect(GUEST_RETURN_TO).toBe('/ask?continue=1');
    const enc = encodeURIComponent('/ask?continue=1');
    expect(SIGN_IN_HREF).toBe(`/sign-in?redirect_url=${enc}`);
    expect(SIGN_UP_HREF).toBe(`/sign-up?redirect_url=${enc}`);
  });

  it('the /ask header and the signup wall import the shared links, not local copies', () => {
    expect(importsFunnelLinks(ASK_LAYOUT_SRC)).toBe(true);
    expect(ASK_LAYOUT_SRC).toContain('href={SIGN_IN_HREF}');
    expect(importsFunnelLinks(GUEST_WALL_SRC)).toBe(true);
    // No file redefines the anchor locally (drift guard).
    for (const src of [LANDING_SRC, ASK_LAYOUT_SRC, GUEST_WALL_SRC]) {
      expect(src).not.toMatch(/const\s+SIGN_IN_HREF\s*=/);
      expect(src).not.toMatch(/const\s+RETURN_TO\s*=/);
    }
  });
});
