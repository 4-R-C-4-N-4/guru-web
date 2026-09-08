/**
 * src/app/api/guest/convert/route.ts
 *
 * POST /api/guest/convert — adopt a just-signed-up visitor's anonymous
 * question into their account (todo:45598ce4).
 *
 * The first-question funnel stores a guest question as a queries row with
 * user_id/session_id NULL and tier_used='guest' (todo:732e73b1). When the
 * visitor signs up, the /ask page returns them here (redirect_url carried
 * ?continue=1) and this endpoint adopts that row IN PLACE:
 *
 *   1. Verify the guru_guest cookie → entitlement id → guest_token_hash.
 *   2. Find their pending guest row (user_id IS NULL, matching hash).
 *   3. Create a real session for the new user (free-tier scholar voice).
 *   4. UPDATE that row: user_id, session_id, tier_used='free', guest_ip NULL
 *      — a single in-place adoption. No copy, no second table; the row that
 *      was a guest question is now the user's first authenticated query, and
 *      the IP (PII) is shed. tier_used flips out of the admin 'guest' bucket.
 *
 * Idempotent: the UPDATE and the pending-row SELECT both gate on
 * `user_id IS NULL`, so a refresh or a double-fire adopts nothing the
 * second time (and the client also strips ?continue=1 + dedupes).
 *
 * Returns { adopted: true, sessionId } on success, or { adopted: false }
 * when there is nothing to adopt (no cookie, cleared cookie, already
 * converted) — the client then just lands the user in the app.
 */

import { requireUser } from '@/lib/auth';
import { withTransaction } from '@/lib/db';
import { DEFAULT_VOICE } from '@/lib/prompt';
import { GUEST_COOKIE, verifyGuestToken, guestTokenHash, readCookie } from '@/lib/guest';

export const runtime = 'nodejs';

/** Expire the guest cookie once its question has been adopted (or found spent). */
const CLEAR_COOKIE = `${GUEST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function POST(req: Request) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const tokenId = verifyGuestToken(readCookie(req.headers, GUEST_COOKIE));
  const nothingToAdopt = () =>
    Response.json({ adopted: false }, { headers: { 'Set-Cookie': CLEAR_COOKIE } });

  if (!tokenId) return nothingToAdopt();
  const hash = guestTokenHash(tokenId);

  // The whole adoption runs in one transaction so it is all-or-nothing: a
  // failed session INSERT can never leave a half-adopted row (user_id set but
  // still tier_used='guest' with the IP un-shed, which would be counted as
  // guest spend forever and be unrecoverable). Returns the new session id, or
  // null when there was nothing to adopt.
  let sessionId: string | null;
  try {
    sessionId = await withTransaction(async (c) => {
      // Atomically CLAIM the pending guest row(s) AND fully convert them in the
      // same statement — set user_id, flip tier_used→'free', shed guest_ip —
      // gated on `user_id IS NULL`. This is the race guard: two tabs both
      // returning with ?continue=1 both run this, but only one UPDATE matches
      // the row; the loser claims zero rows and creates no session. One-shot
      // means at most one row; an IP-backstop accrual of several shares one
      // identity and is adopted together. session_id is set below once created.
      const claimed = (await c.query(
        `UPDATE queries
            SET user_id = $1, tier_used = 'free', guest_ip = NULL
          WHERE guest_token_hash = $2 AND user_id IS NULL
          RETURNING id, query_text`,
        [user.id, hash]
      )).rows as { id: string; query_text: string }[];
      if (claimed.length === 0) return null;

      // Create the session the adopted query will live in. Free-tier voice:
      // a brand-new account is always free (BRD-chat-voice §5).
      const session = (await c.query(
        `INSERT INTO sessions (user_id, title, voice, created_at, updated_at)
         VALUES ($1, $2, $3, now(), now())
         RETURNING id`,
        [user.id, claimed[0]!.query_text.slice(0, 80), DEFAULT_VOICE]
      )).rows[0] as { id: string } | undefined;
      if (!session) throw new Error('session insert returned no row'); // → ROLLBACK

      await c.query(
        `UPDATE queries SET session_id = $1 WHERE id = ANY($2)`,
        [session.id, claimed.map((r) => r.id)]
      );
      return session.id;
    });
  } catch (err) {
    // Rolled back — the guest row is untouched and a retry can re-claim it.
    console.error('[api/guest/convert] adoption failed, rolled back:', err);
    return Response.json({ adopted: false, error: 'Could not adopt guest question' }, { status: 500 });
  }

  if (sessionId === null) return nothingToAdopt();

  return Response.json(
    { adopted: true, sessionId },
    { headers: { 'Set-Cookie': CLEAR_COOKIE } },
  );
}
