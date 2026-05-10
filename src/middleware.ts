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
    // Skip Next internals + static assets (standard Clerk pattern).
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run on API routes.
    '/(api|trpc)(.*)',
  ],
};
