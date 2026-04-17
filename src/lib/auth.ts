/**
 * src/lib/auth.ts
 *
 * Server-side auth helpers for Route Handlers and Server Components.
 * Wraps Clerk's auth() and currentUser() with app-specific helpers.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { one } from './db';
import type { User } from './types';

/**
 * requireUser() — use in Route Handlers.
 *
 * Returns the authenticated app User record (from our DB).
 * Returns a 401 Response if the user is not signed in.
 * The caller should check the return type and return early on Response.
 *
 * Usage:
 *   const result = await requireUser();
 *   if (result instanceof Response) return result;
 *   const user = result;
 */
export async function requireUser(): Promise<User | Response> {
  const { userId } = await auth();

  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await one<User>(
    `SELECT id, email, tier, stripe_customer_id FROM users WHERE id = $1`,
    [userId]
  );

  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 401 });
  }

  return user;
}

/**
 * requireTier() — use in Route Handlers that need a specific tier.
 *
 * Returns the User if tier matches, or a 403 Response.
 */
export async function requireTier(
  requiredTier: 'pro'
): Promise<User | Response> {
  const result = await requireUser();
  if (result instanceof Response) return result;

  if (result.tier !== requiredTier) {
    return Response.json(
      { error: 'Pro subscription required' },
      { status: 403 }
    );
  }

  return result;
}

/**
 * getClerkUser() — get the full Clerk user object (includes email addresses).
 * Only needed for operations like syncing email from Clerk → our DB.
 */
export async function getClerkUser() {
  return currentUser();
}
