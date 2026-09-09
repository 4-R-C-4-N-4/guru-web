/**
 * src/__tests__/landing-cta.test.ts
 *
 * Source-level guard for the landing page's primary CTA (todo:f138c9ad).
 *
 * The "Begin" button used to point at /sign-up (forced auth before seeing
 * anything). Then it became "Try it free" → /ask. Now the primary path is the
 * live ask composer embedded directly in the hero (headingless <AskView>), so
 * a signed-out visitor asks one real question on / with no click-through and
 * gets a streamed answer before the signup wall. A "Sign in" link stays →
 * /sign-in for visitors who know they have an account and want to jump in.
 *
 * The /ask layout's "Sign in" affordance also carries redirect_url=/ask?continue=1
 * so a visitor who clicks it mid-funnel returns through the GuestConvert
 * conversion effect — same anchor as the guest wall buttons.
 *
 * Behaviour isn't testable without Clerk + Next runtime, so we pin the
 * hrefs in source — identical to the blog-nav / sign-in-redirect-prop guard
 * style.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANDING_SRC = readFileSync(resolve(__dirname, '../components/landing.tsx'), 'utf8');
const ASK_LAYOUT_SRC = readFileSync(resolve(__dirname, '../app/ask/layout.tsx'), 'utf8');

describe('Landing primary CTA (todo:f138c9ad)', () => {
  it('embeds the ask composer directly (headingless AskView), not a click-through', () => {
    expect(LANDING_SRC).toMatch(/import\s+AskView\s+from\s+['"]@\/components\/ask-view['"]/);
    expect(LANDING_SRC).toContain('<AskView showHeading={false}');
    // The old click-through button is gone — the composer IS the CTA.
    expect(LANDING_SRC).not.toContain('>Try it free</Link>');
  });

  it('keeps a "Sign in" link to /sign-in for returning users', () => {
    expect(LANDING_SRC).toContain('href="/sign-in"');
    expect(LANDING_SRC).toContain('Sign in</Link>');
  });

  it('no longer routes Begin to /sign-up', () => {
    expect(LANDING_SRC).not.toMatch(/href="\/sign-up"/);
    expect(LANDING_SRC).not.toContain('Begin');
  });
});

describe('Ask layout sign-in return anchor (todo:f138c9ad)', () => {
  it('routes the layout "Sign in" link back to /ask?continue=1 for conversion', () => {
    expect(ASK_LAYOUT_SRC).toContain(`href={SIGN_IN_HREF}`);
    // RETURN_TO is the literal return anchor; the sign-in link carries it
    // via redirect_url so GuestConvert's ?continue=1 effect fires on return.
    expect(ASK_LAYOUT_SRC).toContain(`/ask?continue=1`);
    expect(ASK_LAYOUT_SRC).toContain(`RETURN_TO`);
  });
});
