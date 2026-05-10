/**
 * src/middleware.ts
 *
 * Clerk middleware wrapper. Wires Clerk session decoding into the
 * request context so handlers that call auth() / useUser() see the
 * caller's userId.
 *
 * /admin and /api/admin used to have an allowlist + iat-ceiling
 * gate here, that moved out post 2026-05-09 cutover. Clerk's
 * production keys are domain-locked to guru-ai.org and refuse to
 * operate on the tailnet hostname where /admin actually lives —
 * making the in-process Clerk gate structurally impossible. Trust
 * for /admin now comes from the tailnet Caddy listener
 * (deploy/Caddyfile injects X-Tailnet-Trust on the tailnet listener
 * and strips any inbound copy on the public listener); see
 * src/lib/admin.ts requireAdmin() for the handler-level check.
 *
 * Why we short-circuit admin paths in the handler instead of just
 * the matcher. Even with our handler doing nothing, clerkMiddleware
 * on a non-prod-domain host (tailnet) triggers an internal
 * handshake-rewrite to a synthetic /clerk_<id> path when there's no
 * session token. Next then renders 404 against that synthetic path;
 * in a browser the 404 page client-side redirects to
 * accounts.guru-ai.org/sign-in (the Clerk Account Portal). For admin
 * paths — which no longer use Clerk at all — that handshake masks
 * requireAdmin() and breaks /admin entirely on the tailnet host.
 *
 * The matcher config below ALSO excludes admin paths via lookahead,
 * but Next 16's matcher engine appears to not honor those lookaheads
 * in the same way a JS RegExp does — observed live in production
 * with `x-clerk-auth-reason: protect-rewrite` headers still being
 * emitted on /admin requests after a matcher-only fix. The
 * handler-level early-return below is the bulletproof gate; the
 * matcher exclusion stays as belt-and-suspenders for whatever Next
 * does honor it.
 *
 * Spec: BRD-admin-ui §1.2 (revised).
 */

import { clerkMiddleware } from '@clerk/nextjs/server';
import type { NextRequest, NextFetchEvent } from 'next/server';

const clerkHandler = clerkMiddleware(async () => {
  // No path-specific work. clerkMiddleware sets up the auth context
  // for handlers that call auth(); nothing else happens at the
  // middleware layer.
});

/**
 * Match /admin and /api/admin exactly, plus their subpaths. The
 * trailing alternation `(\/|$)` distinguishes /admin from
 * hypothetical paths like /administration that just happen to share
 * the prefix.
 */
const ADMIN_PATH = /^\/(admin|api\/admin)(\/|$)/;

export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  if (ADMIN_PATH.test(req.nextUrl.pathname)) {
    // Bypass clerkMiddleware entirely. Trust + auth for admin lives
    // in Caddy + requireAdmin(); Clerk has nothing to contribute and
    // its handshake protocol actively breaks admin on tailnet.
    return;
  }
  return clerkHandler(req, ev);
}

export const config = {
  matcher: [
    // Skip Next internals, static assets, and admin paths. The admin
    // exclusion duplicates the handler-level guard — kept here as
    // belt-and-suspenders. The handler is what we actually rely on.
    '/((?!_next|admin|api/admin|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // /api/* and /trpc/* — but NOT /api/admin/*.
    '/(api(?!/admin)|trpc)(.*)',
  ],
};
