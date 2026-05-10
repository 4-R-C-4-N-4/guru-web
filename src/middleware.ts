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
 * Why the matcher excludes admin paths. Even with our handler doing
 * nothing, clerkMiddleware on a non-prod-domain host (tailnet)
 * triggers an internal handshake-rewrite to a synthetic /clerk_*
 * path when there's no session token. Next then renders 404 against
 * that synthetic path; in a browser the 404 page client-side
 * redirects to accounts.guru-ai.org/sign-in, which is exactly the
 * Clerk Account Portal. For admin paths — which no longer use Clerk
 * at all — that handshake is pure noise that masks requireAdmin().
 * Excluding /admin and /api/admin from the matcher keeps clerkMiddleware
 * out of those code paths entirely.
 *
 * Spec: BRD-admin-ui §1.2 (revised).
 */

import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware(async () => {
  // No path-specific work. clerkMiddleware sets up the auth context
  // for handlers that call auth(); nothing else happens at the
  // middleware layer.
});

export const config = {
  matcher: [
    // Skip Next internals, static assets, and admin paths (the latter
    // are gated by Caddy + requireAdmin(), not Clerk — see file
    // docstring).
    '/((?!_next|admin|api/admin|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // /api/* and /trpc/* — but NOT /api/admin/*. The (?!/admin)
    // negative lookahead keeps clerkMiddleware off the admin API.
    '/(api(?!/admin)|trpc)(.*)',
  ],
};
