/**
 * src/__tests__/admin.test.ts
 *
 * Unit tests for the admin auth gate:
 *   - lib/admin requireAdmin() (handler-level check)
 *   - middleware.ts (request-time check)
 *
 * Strategy:
 *   - Mock @clerk/nextjs/server's auth() so we control the userId +
 *     sessionClaims per test.
 *   - Mock clerkMiddleware so it just calls our handler with the
 *     mocked auth function — we get to assert what NextResponse our
 *     middleware returns without spinning up a Next runtime.
 *   - Mock @/lib/db so requireAdmin() doesn't hit Postgres.
 *   - Set / unset process.env.ADMIN_USER_IDS per test.
 *
 * Spec: BRD-admin-ui §1.1, §1.2, §1.13. IMPL plan §2.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  one:  vi.fn(),
  exec: vi.fn(),
}));

const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  auth: mockAuth,
  // clerkMiddleware(handler) → (req) => handler(authFn, req).
  // Lets us drive the middleware with a synthetic NextRequest.
  clerkMiddleware: (handler: (auth: typeof mockAuth, req: unknown) => unknown) => {
    return (req: unknown) => handler(mockAuth, req);
  },
  createRouteMatcher:
    (patterns: string[]) =>
    (req: { nextUrl: { pathname: string } }) => {
      const path = req.nextUrl.pathname;
      return patterns.some((p) => {
        // Translate the /admin/(.*) form to a real RegExp.
        const re = new RegExp('^' + p.replace(/\(\.\*\)/g, '.*') + '$');
        return re.test(path);
      });
    },
}));

import * as db from '@/lib/db';
const mockOne = db.one as MockedFunction<typeof db.one>;

// Handle on the env var so tests can flip it.
const ORIGINAL_ENV = process.env.ADMIN_USER_IDS;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_USER_IDS = ORIGINAL_ENV;
});

// ── requireAdmin ─────────────────────────────────────────────────────

describe('requireAdmin()', () => {
  it('returns 404 Response when ADMIN_USER_IDS is unset', async () => {
    delete process.env.ADMIN_USER_IDS;
    mockAuth.mockResolvedValueOnce({ userId: 'user_admin' });

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
    expect(mockOne).not.toHaveBeenCalled();
  });

  it('returns 404 Response when caller is not in the allowlist', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin1,user_admin2';
    mockAuth.mockResolvedValueOnce({ userId: 'user_outsider' });

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
    expect(mockOne).not.toHaveBeenCalled();
  });

  it('returns 404 Response when caller is unauthenticated', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin';
    mockAuth.mockResolvedValueOnce({ userId: null });

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it('returns the User record when caller is in the allowlist and active', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin,user_other';
    mockAuth.mockResolvedValueOnce({ userId: 'user_admin' });
    mockOne.mockResolvedValueOnce({
      id: 'user_admin', email: 'op@example.com', tier: 'pro', stripe_customer_id: null,
    });

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).not.toBeInstanceOf(Response);
    expect((result as { id: string }).id).toBe('user_admin');

    // Regression: must filter soft-deleted users (mirror of requireUser()).
    const [sql, params] = mockOne.mock.calls[0]!;
    expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(params).toEqual(['user_admin']);
  });

  it('returns 404 if the allowlisted user has no active row in users', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin';
    mockAuth.mockResolvedValueOnce({ userId: 'user_admin' });
    mockOne.mockResolvedValueOnce(null); // soft-deleted or never inserted

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it('tolerates whitespace and empty entries in ADMIN_USER_IDS', async () => {
    process.env.ADMIN_USER_IDS = ' user_admin , ,user_other ';
    mockAuth.mockResolvedValueOnce({ userId: 'user_admin' });
    mockOne.mockResolvedValueOnce({
      id: 'user_admin', email: 'op@x', tier: 'pro', stripe_customer_id: null,
    });

    const { requireAdmin } = await import('@/lib/admin');
    const result = await requireAdmin();
    expect(result).not.toBeInstanceOf(Response);
  });
});

// ── middleware ───────────────────────────────────────────────────────

function makeReq(pathname: string) {
  // Minimal NextRequest stand-in. The middleware only touches
  // .nextUrl.{pathname,search,clone,searchParams}.
  return {
    nextUrl: {
      pathname,
      search: '',
      clone() {
        const u = new URL(`http://localhost${pathname}`);
        // Mirror NextURL.clone() returning a mutable URL with searchParams.
        return u;
      },
    },
  };
}

describe('admin middleware', () => {
  const NOW_S = 1_700_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_S * 1000));
    process.env.ADMIN_USER_IDS = 'user_admin';
  });

  it('rewrites non-admin /admin requests to /admin-404', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'user_outsider', sessionClaims: { iat: NOW_S } });

    const middleware = (await import('@/middleware')).default;
    const res = await middleware(makeReq('/admin/users') as never, {} as never);

    expect(res).toBeDefined();
    // NextResponse.rewrite sets x-middleware-rewrite to the target URL.
    const rewriteTo = (res as Response).headers.get('x-middleware-rewrite');
    expect(rewriteTo).toContain('/admin-404');
  });

  it('rewrites /api/admin to /admin-404 for non-admins', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'user_outsider', sessionClaims: { iat: NOW_S } });

    const middleware = (await import('@/middleware')).default;
    const res = await middleware(makeReq('/api/admin/overview') as never, {} as never);

    const rewriteTo = (res as Response).headers.get('x-middleware-rewrite');
    expect(rewriteTo).toContain('/admin-404');
  });

  it('lets admin /admin/* requests through with a fresh session', async () => {
    mockAuth.mockResolvedValueOnce({
      userId: 'user_admin',
      sessionClaims: { iat: NOW_S - 60 }, // 1 min old
    });

    const middleware = (await import('@/middleware')).default;
    const res = await middleware(makeReq('/admin') as never, {} as never);

    // No rewrite, no redirect — middleware returns undefined to pass through.
    expect(res).toBeUndefined();
  });

  it('forces re-auth when admin session iat > 1h old', async () => {
    mockAuth.mockResolvedValueOnce({
      userId: 'user_admin',
      sessionClaims: { iat: NOW_S - 60 * 60 - 1 }, // just over 1h
    });

    const middleware = (await import('@/middleware')).default;
    const res = await middleware(makeReq('/admin/users') as never, {} as never);

    expect(res).toBeDefined();
    // NextResponse.redirect → 307/308 with Location header.
    const location = (res as Response).headers.get('location');
    expect(location).toContain('/sign-in');
    expect(location).toContain('redirect_url=');
  });

  it('redirects to sign-in when iat is missing on the session', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'user_admin', sessionClaims: {} });

    const middleware = (await import('@/middleware')).default;
    const res = await middleware(makeReq('/admin') as never, {} as never);

    expect((res as Response).headers.get('location')).toContain('/sign-in');
  });

  it('does not affect non-admin paths', async () => {
    // Even with a clearly-non-admin caller, the middleware shouldn't
    // touch /chat etc.
    mockAuth.mockResolvedValueOnce({ userId: 'user_outsider' });

    const middleware = (await import('@/middleware')).default;
    const res = await middleware(makeReq('/chat') as never, {} as never);

    expect(res).toBeUndefined();
    // We never even checked auth for non-admin paths.
    expect(mockAuth).not.toHaveBeenCalled();
  });
});
