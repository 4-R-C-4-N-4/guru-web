/**
 * src/proxy.ts
 *
 * (Renamed from src/middleware.ts — Next 16 compiles proxy.ts, not
 * middleware.ts; under the old name this logic was silently dropped
 * and Clerk's default protective middleware ran instead, gating
 * /blog and /chat. See ticket 0f850d3c.)
 *
 * Clerk middleware wrapper. Wires Clerk session decoding into the
 * request context so public-domain handlers that call auth() /
 * useUser() see the caller's userId.
 *
 * Filename: Next 16 renamed the middleware.ts file convention to
 * proxy.ts ("ƒ Proxy (Middleware)" in build output). Live diagnostic
 * during the 2026-05-09 cutover proved that Next 16 + Turbopack
 * silently ignores src/middleware.ts and substitutes a default
 * middleware bundle — the deployed manifest's matcher came back
 * verbatim from Clerk's recommended default, with none of our
 * admin exclusions or host checks even though they were in the
 * source. proxy.ts is the file Next 16 actually compiles.
 *
 * Output mode: `output: "standalone"` was removed from
 * next.config.ts at the same time because Next 16.2.4's standalone
 * collector errors with `ENOENT: middleware.js.nft.json` when the
 * source is proxy.ts. deploy.sh + guru-web.service were updated to
 * run `next start` against the release dir directly.
 *
 * Two-axis bypass — both axes can fire, both lead to "skip Clerk":
 *
 *   1. Tailnet host (axis: who's asking)
 *      Any request whose Host header matches the tailnet hostname
 *      skips clerkMiddleware entirely. Clerk's production keys are
 *      domain-locked to guru-ai.org and refuse to operate on tailnet;
 *      letting clerkMiddleware fire there triggers a protect-rewrite
 *      to /clerk_<id> for EVERY request — observed live during the
 *      2026-05-09 cutover, where /chat and /notarealpath both 404'd
 *      with `x-clerk-auth-reason: protect-rewrite`. The tailnet
 *      hostname is admin-only — Clerk has nothing useful to do there.
 *
 *   2. Admin path (axis: which path)
 *      /admin and /api/admin paths skip Clerk regardless of host.
 *      The public listener already rewrites those paths to /admin-404
 *      via Caddy, so this is mostly belt-and-suspenders for the
 *      tailnet case. Trust for admin comes from Caddy's
 *      X-Tailnet-Trust header + the handler-level requireAdmin()
 *      check (src/lib/admin.ts).
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

/**
 * Tailnet hostname. Hardcoded to match deploy/Caddyfile — both
 * places need updating together if the tailnet suffix changes.
 */
const TAILNET_HOST = 'guru-web-prod.tailb5626e.ts.net';

export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  // Axis 1: skip everything Clerk-related on tailnet, regardless of path.
  if (req.headers.get('host') === TAILNET_HOST) {
    return;
  }

  // Axis 2: skip Clerk on admin paths even on the public host. Caddy
  // already rewrites /admin → /admin-404 there, so this is defensive.
  if (ADMIN_PATH.test(req.nextUrl.pathname)) {
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
