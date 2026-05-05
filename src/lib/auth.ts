/**
 * src/lib/auth.ts
 *
 * Server-side auth helpers for Route Handlers and Server Components.
 * Wraps Clerk's auth() and currentUser() with app-specific helpers.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import { exec, one } from './db';
import type { User } from './types';

const SELECT_USER_SQL = `SELECT id, email, tier, stripe_customer_id FROM users
                           WHERE id = $1 AND deleted_at IS NULL`;

/**
 * requireUser() — use in Route Handlers.
 *
 * Returns the authenticated app User record (from our DB).
 * Returns a 401 Response if the user is not signed in.
 * The caller should check the return type and return early on Response.
 *
 * On a missing users row for a signed-in Clerk user we lazy-upsert from
 * currentUser() rather than 401'ing (todo:a7ffea2b). The Clerk
 * user.created webhook *should* land first and create the row, but
 * webhook delays of a few seconds are normal and a missed delivery
 * (network blip, secret-rotation gap) would otherwise lock the user
 * out forever. Lazy upsert closes that gap. ON CONFLICT DO NOTHING
 * means a soft-deleted row stays soft-deleted — the re-SELECT then
 * returns null and we 401, which is the correct behavior for a user
 * who explicitly deleted their account.
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

  const existing = await one<User>(SELECT_USER_SQL, [userId]);
  if (existing) return existing;

  // No active row. Could be (a) Clerk webhook delayed/missed for a
  // brand-new signup, or (b) the user soft-deleted. Distinguish via
  // currentUser(): if Clerk has no current record either, this is a
  // stale session — 401. If Clerk knows about them, lazy-upsert.
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return Response.json({ error: 'User not found' }, { status: 401 });
  }

  const email = clerkUser.primaryEmailAddress?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress
    ?? null;
  if (!email) {
    return Response.json({ error: 'No email on Clerk user' }, { status: 401 });
  }

  try {
    await exec(
      `INSERT INTO users (id, email, tier, created_at, updated_at)
       VALUES ($1, $2, 'free', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [userId, email]
    );
  } catch (err) {
    // Likely a UNIQUE(email) collision with a soft-deleted account
    // re-registering with the same address (todo:ab118d8c). Surface
    // it for ops; user gets a generic 401.
    console.error('[requireUser] lazy upsert failed:', err);
    return Response.json({ error: 'User not found' }, { status: 401 });
  }

  const created = await one<User>(SELECT_USER_SQL, [userId]);
  if (!created) {
    // ON CONFLICT was a no-op (soft-deleted row exists). Keep 401.
    return Response.json({ error: 'User not found' }, { status: 401 });
  }
  return created;
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

