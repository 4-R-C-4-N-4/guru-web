/**
 * src/__tests__/admin.test.ts
 *
 * Unit tests for the post-cutover admin auth model:
 *   - lib/admin requireAdmin() returns the synthetic tailnet operator
 *     when Caddy injects X-Tailnet-Trust=1, a 404 Response otherwise,
 *     and unconditionally allows in NODE_ENV=development.
 *   - middleware.ts no longer touches /admin paths (the in-process
 *     gate moved to handler-level requireAdmin()).
 *
 * Strategy:
 *   - Mock next/headers's headers() to feed requireAdmin() a synthetic
 *     Headers object per test.
 *   - Mock @clerk/nextjs/server's clerkMiddleware so we can drive the
 *     middleware with a synthetic NextRequest and assert the new
 *     pass-through behaviour for /admin paths.
 *
 * Spec: BRD-admin-ui §1.1, §1.2 (revised post 2026-05-09 cutover).
 *       todo:d3700325.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockHeaders = vi.fn<() => Headers>();
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(mockHeaders()),
}));

vi.mock('@clerk/nextjs/server', () => ({
  // clerkMiddleware(handler) → (req) => handler(authFn, req).
  // The post-cutover middleware no longer reads auth() at all for
  // admin paths, but we keep the mock shape compatible so handler
  // callbacks that take both args don't blow up.
  clerkMiddleware: (handler: (auth: () => unknown, req: unknown) => unknown) => {
    return (req: unknown) => handler(() => Promise.resolve({}), req);
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: simulate test/prod (no dev bypass) and no trust header.
  // vi.stubEnv is the supported way to override process.env in vitest;
  // direct assignment fails with "only accepts a configurable, writable,
  // and enumerable data descriptor" under vitest's process.env trap.
  vi.stubEnv('NODE_ENV', 'test');
  mockHeaders.mockReturnValue(new Headers());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── requireAdmin ─────────────────────────────────────────────────────

describe('requireAdmin()', () => {
  it('returns the synthetic operator when X-Tailnet-Trust=1', async () => {
    mockHeaders.mockReturnValue(new Headers({ 'x-tailnet-trust': '1' }));

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).not.toBeInstanceOf(Response);
    const operator = result as { id: string; email: string; tier: string };
    expect(operator.id).toBe('tailnet');
    expect(operator.email).toBe('admin@tailnet');
    expect(operator.tier).toBe('pro');
  });

  it('returns 404 Response when X-Tailnet-Trust is absent', async () => {
    mockHeaders.mockReturnValue(new Headers());

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it('returns 404 Response when X-Tailnet-Trust has any other value', async () => {
    // Defends against a bug where someone sets the header to "true"
    // or "yes" or empty string and accidentally trips a truthy check.
    mockHeaders.mockReturnValue(new Headers({ 'x-tailnet-trust': 'true' }));

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it('returns the synthetic operator unconditionally in NODE_ENV=development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    // Even with no trust header, dev bypass returns the operator.
    mockHeaders.mockReturnValue(new Headers());

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).not.toBeInstanceOf(Response);
    expect((result as { id: string }).id).toBe('tailnet');
  });

  it('does NOT bypass in NODE_ENV=test (vitest default)', async () => {
    // Regression: dev bypass must be scoped narrowly so test runs
    // exercise the production path.
    expect(process.env.NODE_ENV).toBe('test');
    mockHeaders.mockReturnValue(new Headers());

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });
});

// ── middleware ───────────────────────────────────────────────────────

function makeReq(pathname: string) {
  return {
    nextUrl: {
      pathname,
      search: '',
      clone() {
        return new URL(`http://localhost${pathname}`);
      },
    },
  };
}

describe('middleware (post-cutover)', () => {
  it('does not touch /admin paths — they pass through to the handler', async () => {
    // The pre-cutover middleware rewrote /admin to /admin-404 for
    // non-admins and redirected stale-iat admins to /sign-in. Both
    // moved out: Caddy is the tailnet gate, requireAdmin() is the
    // handler-level gate. The middleware no longer cares about the
    // admin path shape.
    const middleware = (await import('@/proxy')).default;
    const res = await middleware(makeReq('/admin/users') as never, {} as never);

    expect(res).toBeUndefined();
  });

  it('does not touch /api/admin paths either', async () => {
    const middleware = (await import('@/proxy')).default;
    const res = await middleware(makeReq('/api/admin/overview') as never, {} as never);

    expect(res).toBeUndefined();
  });

  it('does not touch ordinary app paths', async () => {
    const middleware = (await import('@/proxy')).default;
    const res = await middleware(makeReq('/chat') as never, {} as never);

    expect(res).toBeUndefined();
  });
});

// ── matcher config ───────────────────────────────────────────────────
//
// Even with our handler doing nothing, clerkMiddleware on a non-prod
// host (tailnet) triggers a handshake-rewrite to /clerk_* when there's
// no session, which Next renders 404 → browser redirects to the Clerk
// Account Portal at accounts.<prod-domain>. Excluding /admin and
// /api/admin from the matcher keeps clerkMiddleware off those paths
// entirely. These tests pin the matcher so a future "let me clean up
// the regex" change can't silently re-include admin paths.

describe('middleware matcher config', () => {
  // Compile each Next-style matcher pattern to a JS regex. Anchored
  // both ends so the test models "does Next decide to run middleware
  // for this exact path." This is an approximation of Next's compiled
  // matcher (which uses path-to-regexp under the hood) — sufficient
  // for the lookahead-based exclusions we care about.
  function matchesAny(path: string, patterns: string[]): boolean {
    return patterns.some((p) => new RegExp(`^${p}$`).test(path));
  }

  it('excludes /admin paths', async () => {
    const { config } = await import('@/proxy');
    expect(matchesAny('/admin',                config.matcher)).toBe(false);
    expect(matchesAny('/admin/users',          config.matcher)).toBe(false);
    expect(matchesAny('/admin/sessions/abc',   config.matcher)).toBe(false);
  });

  it('excludes /api/admin paths', async () => {
    const { config } = await import('@/proxy');
    expect(matchesAny('/api/admin',            config.matcher)).toBe(false);
    expect(matchesAny('/api/admin/overview',   config.matcher)).toBe(false);
    expect(matchesAny('/api/admin/users/xyz',  config.matcher)).toBe(false);
  });

  it('still fires on ordinary app and api paths', async () => {
    const { config } = await import('@/proxy');
    expect(matchesAny('/chat',                 config.matcher)).toBe(true);
    expect(matchesAny('/account',              config.matcher)).toBe(true);
    expect(matchesAny('/api/query',            config.matcher)).toBe(true);
    expect(matchesAny('/api/preferences',      config.matcher)).toBe(true);
  });

  it('still excludes Next internals and static files', async () => {
    const { config } = await import('@/proxy');
    expect(matchesAny('/_next/static/foo',     config.matcher)).toBe(false);
    expect(matchesAny('/favicon.ico',          config.matcher)).toBe(false);
    expect(matchesAny('/foo.css',              config.matcher)).toBe(false);
  });
});
