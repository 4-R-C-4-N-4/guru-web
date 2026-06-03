/**
 * src/__tests__/landing-page-redirect.test.ts
 *
 * Source-level guard against the "router.replace() during render"
 * anti-pattern in client components (todo:08fd0a9a, todo:9dc2f674).
 *
 * Bug class: calling `router.replace(...)` directly in a component
 * body mutates router state during render. React 19 / Next 16 warns:
 *   "Cannot update a component (Router) while rendering a different
 *    component."
 *
 * Fix: the redirect lives in a useEffect; the render-time branch only
 * returns null.
 *
 * Covered:
 *   - src/components/landing.tsx     — signed-in → /chat (the homepage's
 *     interactive client component; src/app/page.tsx is now a server wrapper)
 *   - src/app/(app)/layout.tsx       — signed-out → /sign-in
 *
 * Behaviour test isn't possible without spinning up Clerk + Next's
 * client runtime. Pinning the source is the contract these PRs can
 * defend — mirrors the pattern in sign-in-redirect-prop.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TARGETS: Array<{ label: string; relPath: string; destination: string }> = [
  { label: 'Landing (signed-in)',     relPath: '../components/landing.tsx', destination: '/chat' },
  { label: 'AppLayout (signed-out)',  relPath: '../app/(app)/layout.tsx', destination: '/sign-in' },
];

describe('client-component redirects run in useEffect, not during render', () => {
  it.each(TARGETS)('$label imports useEffect', ({ relPath }) => {
    const src = readFileSync(resolve(__dirname, relPath), 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*\buseEffect\b[^}]*\}\s*from\s*['"]react['"]/);
  });

  it.each(TARGETS)('$label calls router.replace inside a useEffect', ({ relPath, destination }) => {
    const src = readFileSync(resolve(__dirname, relPath), 'utf8');
    const pattern = new RegExp(
      String.raw`useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?router\.replace\(\s*['"]${destination}['"]\s*\)`,
    );
    expect(src).toMatch(pattern);
  });

  it.each(TARGETS)('$label does NOT call router.replace inline during render', ({ relPath }) => {
    const src = readFileSync(resolve(__dirname, relPath), 'utf8');
    // Regression pattern: bare `if (...) { router.replace(...) }` at the top
    // of the component body, not nested inside a useEffect callback.
    expect(src).not.toMatch(/^\s*if\s*\([^)]*isSignedIn[^)]*\)\s*\{\s*\n\s*router\.replace/m);
  });
});
