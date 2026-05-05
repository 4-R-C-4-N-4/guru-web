/**
 * src/lib/admin.ts
 *
 * Admin auth helper. Mirrors the shape of requireUser() in lib/auth.ts
 * but checks ADMIN_USER_IDS (comma-separated Clerk user IDs from
 * /etc/guru-web.env) instead of the regular signed-in check.
 *
 * Spec: BRD-admin-ui §1.1, §1.2.
 *
 * Failure mode is 404, never 401/403. The admin surface is supposed to
 * be indistinguishable from a non-existent path even on the tailnet
 * hostname — anything more specific leaks the existence of /admin to a
 * caller who shouldn't know it's there.
 */

import { auth } from '@clerk/nextjs/server';
import { one } from './db';
import type { User } from './types';

function adminAllowlist(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS;
  if (!raw) return new Set();
  return new Set(
    raw.split(',').map((s) => s.trim()).filter(Boolean),
  );
}

/**
 * requireAdmin() — use in /api/admin/* Route Handlers.
 *
 * Returns the authenticated app User record on success. On any failure
 * (unauthenticated, not in allowlist, allowlist unset) returns a 404
 * Response — the caller should check the return type and return early.
 *
 * Defense in depth: this is the third gate after Caddy (§0.1) and
 * middleware (§1.2). All three return the same shape so a routing bug
 * in any one of them doesn't reveal that the others exist.
 */
export async function requireAdmin(): Promise<User | Response> {
  const allow = adminAllowlist();
  const { userId } = await auth();

  if (!userId || !allow.has(userId)) {
    return new Response(null, { status: 404 });
  }

  const user = await one<User>(
    `SELECT id, email, tier, stripe_customer_id, payment_state FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );

  if (!user) {
    return new Response(null, { status: 404 });
  }

  return user;
}

/**
 * isAdmin(userId) — pure check used by the middleware where we don't
 * want to hit the DB on every request. The middleware's role is just
 * to reject non-admins before any handler runs; the handler itself
 * still calls requireAdmin() for the User-record fetch.
 */
export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return adminAllowlist().has(userId);
}
