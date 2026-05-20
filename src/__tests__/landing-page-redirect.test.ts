/**
 * src/__tests__/landing-page-redirect.test.ts
 *
 * Source-level guard for the landing-page redirect (todo:08fd0a9a).
 *
 * Bug: LandingPage called `router.replace('/chat')` directly in the
 * component body when the user was signed-in. Under React 19 / Next 16
 * this triggers a "Cannot update a component (Router) while rendering
 * a different component (LandingPage)" warning, because router state
 * is being mutated synchronously during render.
 *
 * Fix: the redirect lives in a useEffect; the render-time branch only
 * returns null.
 *
 * Behaviour test isn't possible without spinning up Clerk + Next's
 * client runtime. Pinning the source is the contract this PR can
 * defend — mirrors the pattern in sign-in-redirect-prop.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_SRC = readFileSync(resolve(__dirname, '../app/page.tsx'), 'utf8');

describe('LandingPage signed-in redirect', () => {
  it('imports useEffect', () => {
    expect(PAGE_SRC).toMatch(/import\s*\{[^}]*\buseEffect\b[^}]*\}\s*from\s*['"]react['"]/);
  });

  it('calls router.replace inside a useEffect', () => {
    // useEffect( ... router.replace('/chat') ... )
    expect(PAGE_SRC).toMatch(
      /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?router\.replace\(\s*['"]\/chat['"]\s*\)/
    );
  });

  it('does NOT call router.replace inline during render', () => {
    // Regression pattern: bare `if (...isSignedIn) { router.replace(...) }`
    // sitting at the top level of the component body.
    expect(PAGE_SRC).not.toMatch(
      /^\s*if\s*\([^)]*isSignedIn[^)]*\)\s*\{\s*\n\s*router\.replace/m
    );
  });
});
