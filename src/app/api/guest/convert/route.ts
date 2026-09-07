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
import { one, exec } from '@/lib/db';
import { DEFAULT_VOICE } from '@/lib/prompt';
import { GUEST_COOKIE, verifyGuestToken, guestTokenHash } from '@/lib/guest';

export const runtime = 'nodejs';

function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

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

  // The pending guest question for this token. One-shot means at most one,
  // but LIMIT 1 (newest) is defensive.
  const pending = await one<{ id: string; query_text: string }>(
    `SELECT id, query_text FROM queries
      WHERE guest_token_hash = $1 AND user_id IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [hash]
  );
  if (!pending) return nothingToAdopt();

  // Create the session the adopted query will live in. Free-tier voice —
  // a brand-new account is always free (BRD-chat-voice §5).
  const session = await one<{ id: string }>(
    `INSERT INTO sessions (user_id, title, voice, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     RETURNING id`,
    [user.id, pending.query_text.slice(0, 80), DEFAULT_VOICE]
  );
  if (!session) {
    // Session insert failed — leave the guest row untouched so a retry can
    // still adopt it. Don't clear the cookie.
    return Response.json({ adopted: false, error: 'Could not create session' }, { status: 500 });
  }

  // Adopt in place. The WHERE user_id IS NULL keeps this idempotent: a
  // second fire matches nothing.
  await exec(
    `UPDATE queries
        SET user_id = $1, session_id = $2, tier_used = 'free', guest_ip = NULL
      WHERE guest_token_hash = $3 AND user_id IS NULL`,
    [user.id, session.id, hash]
  );

  return Response.json(
    { adopted: true, sessionId: session.id },
    { headers: { 'Set-Cookie': CLEAR_COOKIE } },
  );
}
