/**
 * src/middleware.ts
 *
 * Defense-in-depth gate for /admin and /api/admin. The Caddy public
 * listener (deploy/Caddyfile) already rewrites those paths to
 * /admin-404 on the public hostname; this is the in-process check
 * that runs on every request, including tailnet-hosted ones.
 *
 * Spec: BRD-admin-ui §1.2, §1.13.
 *
 * What this middleware does:
 *   - For non-admin paths: no-op (just pass through). The rest of the
 *     app uses Clerk's auth() / useUser() in handlers and components,
 *     not middleware-level protection.
 *   - For /admin and /api/admin: if the caller isn't in the
 *     ADMIN_USER_IDS allowlist, rewrite to /admin-404 (same shape as
 *     the Caddy fallback so the two gates are indistinguishable).
 *   - For an authenticated admin: enforce a 1-hour session ceiling on
 *     admin paths only by checking the token's `iat` claim. If the
 *     token was issued >1h ago, redirect to /sign-in to force a fresh
 *     login. Clerk doesn't have per-route session expiries; iat is the
 *     primitive that lets us implement one without changing global
 *     session lifetime.
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';

const isAdminPath = createRouteMatcher(['/admin', '/admin/(.*)', '/api/admin/(.*)']);

const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60; // 1 hour

export default clerkMiddleware(async (auth, req) => {
  if (!isAdminPath(req)) return;

  const { userId, sessionClaims } = await auth();

  if (!isAdmin(userId)) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin-404';
    return NextResponse.rewrite(url);
  }

  // Admin session age ceiling. iat is seconds-since-epoch on the
  // Clerk session token. If the token is older than the ceiling, the
  // operator has to re-authenticate before the admin surface unlocks
  // again — narrows the blast radius of a long-lived session on a
  // device that briefly had admin access.
  const iat = typeof sessionClaims?.iat === 'number' ? sessionClaims.iat : null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (iat === null || nowSeconds - iat > ADMIN_SESSION_MAX_AGE_SECONDS) {
    const signIn = req.nextUrl.clone();
    signIn.pathname = '/sign-in';
    signIn.searchParams.set('redirect_url', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signIn);
  }
});

export const config = {
  matcher: [
    // Skip Next internals + static assets (standard Clerk pattern).
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run on API routes.
    '/(api|trpc)(.*)',
  ],
};
