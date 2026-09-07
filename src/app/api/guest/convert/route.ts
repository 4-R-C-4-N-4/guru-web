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
import { one, exec, query } from '@/lib/db';
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

  // Atomically CLAIM the pending guest row(s) in a single UPDATE gated on
  // `user_id IS NULL`. This is the race guard: two tabs both returning from
  // signup with ?continue=1 both hit this, but only one UPDATE matches the
  // row — the loser gets zero rows and adopts nothing, so no orphan empty
  // session is ever created and no false `adopted:true` is returned. One-shot
  // means at most one row; if the IP backstop let a token accrue several,
  // they share one identity and are adopted together.
  const claimed = await query<{ id: string; query_text: string }>(
    `UPDATE queries SET user_id = $1
       WHERE guest_token_hash = $2 AND user_id IS NULL
       RETURNING id, query_text`,
    [user.id, hash]
  );
  if (claimed.length === 0) return nothingToAdopt();
  const primary = claimed[0]!;
  const claimedIds = claimed.map((r) => r.id);

  // We won the claim — create the session the adopted query will live in.
  // Free-tier voice: a brand-new account is always free (BRD-chat-voice §5).
  const session = await one<{ id: string }>(
    `INSERT INTO sessions (user_id, title, voice, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     RETURNING id`,
    [user.id, primary.query_text.slice(0, 80), DEFAULT_VOICE]
  );
  if (!session) {
    // Session insert failed after we already claimed the row(s). They now
    // belong to the user (user_id set) but have no session; report failure so
    // the client falls back to /chat. A retry can't re-claim (user_id no
    // longer NULL); the rows are simply owned-but-sessionless — harmless.
    return Response.json({ adopted: false, error: 'Could not create session' }, { status: 500 });
  }

  // Attach the claimed row(s) to the new session and normalise them to a
  // free query with the IP shed. Targets exactly the ids we claimed.
  await exec(
    `UPDATE queries
        SET session_id = $1, tier_used = 'free', guest_ip = NULL
      WHERE id = ANY($2)`,
    [session.id, claimedIds]
  );

  return Response.json(
    { adopted: true, sessionId: session.id },
    { headers: { 'Set-Cookie': CLEAR_COOKIE } },
  );
}
