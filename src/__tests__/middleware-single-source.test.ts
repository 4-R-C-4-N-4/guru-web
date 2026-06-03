/**
 * src/__tests__/middleware-single-source.test.ts
 *
 * Source-level guard for the Next 16 middleware convention (todo:0f850d3c).
 *
 * A leftover Clerk-quickstart middleware.ts at the repo root once coexisted
 * with the intended src/middleware.ts pass-through. Next compiled the root
 * file, whose `auth.protect()` gated every route outside a tiny allowlist —
 * so the public /blog redirected signed-out visitors to login. The fix:
 * delete the root file and rename src/middleware.ts -> src/proxy.ts (Next 16's
 * PROXY_FILENAME convention) so the pass-through is the SOLE middleware.
 *
 * Lock in two invariants that, together, would have caught that regression:
 *   1. Exactly one middleware/proxy source exists, and it is src/proxy.ts.
 *   2. That file is a pass-through — it must NOT call auth.protect(), which is
 *      the protect-all footgun the root quickstart file shipped.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');

// Every place Next/Turbopack will look for a middleware or proxy entry.
const MIDDLEWARE_CANDIDATES = [
  'middleware.ts',
  'middleware.js',
  'proxy.ts',
  'proxy.js',
  'src/middleware.ts',
  'src/middleware.js',
  'src/proxy.ts',
  'src/proxy.js',
];

describe('middleware single source', () => {
  it('has exactly one middleware/proxy source, and it is src/proxy.ts', () => {
    const present = MIDDLEWARE_CANDIDATES.filter(p =>
      existsSync(resolve(REPO, p)),
    );
    expect(present).toEqual(['src/proxy.ts']);
  });

  it('keeps proxy.ts a pass-through — no blanket auth.protect()', () => {
    // The root quickstart file's `if (!isPublicRoute) auth.protect()` is the
    // exact pattern that gated /blog. Protection lives at the page/handler
    // layer ((app)/layout.tsx, requireUser, requireAdmin), not here.
    const proxy = readFileSync(resolve(REPO, 'src/proxy.ts'), 'utf8');
    expect(proxy).not.toMatch(/auth\.protect\s*\(/);
  });
});
