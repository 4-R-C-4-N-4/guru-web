/**
 * src/lib/admin.ts
 *
 * Admin auth helper. /admin and /api/admin are reachable only via the
 * tailnet hostname (deploy/Caddyfile tailnet listener); the public
 * Cloudflare-fronted listener rewrites those paths to /admin-404.
 * Trust comes from a Caddy-injected X-Tailnet-Trust header on the
 * tailnet listener; the public listener strips any inbound copy of
 * that header so a malicious caller can't forge it.
 *
 * Spec: BRD-admin-ui §1.1, §1.2 (revised post 2026-05-09 cutover).
 *
 * Why not Clerk-gated. Clerk's production keys are domain-locked at
 * the SDK level — they refuse to initialize on any host other than
 * the registered production domain ("Production Keys are only
 * allowed for domain 'guru-ai.org'"). Multi-domain / satellite is
 * the only Clerk feature that unlocks the tailnet hostname, and it
 * requires a paid plan. The original BRD's "Clerk middleware as
 * third gate of defense in depth" was structurally impossible once
 * the app moved to live keys; the architecture pivots to "tailnet
 * Caddy listener IS the gate, handler-level requireAdmin() is the
 * second gate."
 *
 * Failure mode is 404, never 401/403. The admin surface is supposed
 * to be indistinguishable from a non-existent path even on the
 * tailnet hostname — anything more specific leaks the existence of
 * /admin to a caller who shouldn't know it's there.
 */

import { headers } from 'next/headers';
import type { User } from './types';

/**
 * Synthetic operator returned to /admin handlers. The trust signal
 * is binary — you're on the tailnet or you're not — so there's no
 * per-user record to fetch. id/email are placeholders that callers
 * can use for display or attribution; if multi-admin attribution
 * becomes necessary later, swap for a real lookup keyed off an
 * ADMIN_DISPLAY_EMAIL env var or a Tailscale identity header.
 */
const TAILNET_OPERATOR: User = {
  id: 'tailnet',
  email: 'admin@tailnet',
  tier: 'pro',
  stripe_customer_id: null,
  payment_state: null,
};

/**
 * requireAdmin() — use in /admin pages, layouts, and /api/admin/*
 * route handlers. On success returns the synthetic operator User.
 * On failure (no trust header, no dev bypass) returns a 404
 * Response — callers should check the return type and bail.
 *
 * Dev bypass: when NODE_ENV === 'development' the operator is
 * returned unconditionally so local dev (which doesn't see the
 * Caddy header) keeps working. The bypass is scoped to development
 * only — test runs (NODE_ENV='test') and prod still require the
 * trust header.
 */
export async function requireAdmin(): Promise<User | Response> {
  if (process.env.NODE_ENV === 'development') {
    return TAILNET_OPERATOR;
  }

  const trust = (await headers()).get('x-tailnet-trust');
  if (trust !== '1') {
    return new Response(null, { status: 404 });
  }

  return TAILNET_OPERATOR;
}
