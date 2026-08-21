/**
 * src/app/api/sessions/[id]/share/route.ts
 *
 * POST   /api/sessions/[id]/share — create (or return the existing active)
 *        public share for a session the caller owns.
 * DELETE /api/sessions/[id]/share — revoke the active share.
 *
 * A share is an immutable snapshot (todo:131dbb82, parent todo:36421ff5):
 * everything the public /share/[slug] page and the fork endpoint need is
 * denormalized onto the session_shares row at share time —
 *
 *   - messages: ordered turns with citations rehydrated to rich objects
 *     ({id,tradition,text,section}) NOW, while the chunk ids still
 *     resolve. queries.chunks_used holds bare ids that go stale when the
 *     corpus schema is dropped and re-imported; the blog (013) established
 *     this snapshot-rich-objects pattern.
 *   - voice/mode/study_text_id: copied from the session row.
 *   - retrieval_scope: the owner's user_preferences scope fields frozen at
 *     share time, so later pref changes don't mutate what a fork inherits.
 *
 * The slug is 16 crypto-random bytes base64url (~22 chars) — unguessable,
 * and deliberately not the session uuid so revoking + re-sharing mints a
 * fresh URL. The UNIQUE constraint is the collision backstop; on the
 * astronomically-unlikely 23505 we just mint another.
 *
 * POST is idempotent per session: one active share at a time; re-POST
 * returns the existing slug (reused: true) instead of multiplying URLs.
 */

import { randomBytes } from 'crypto';
import { requireUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { loadPreferences } from '@/lib/prefs';
import { rateLimit } from '@/lib/rate-limit';
import { rehydrateCitations } from '@/lib/corpus';
import type { RetrievalScope } from '@/lib/types';

export const runtime = 'nodejs';

const SLUG_INSERT_ATTEMPTS = 3;

// The partial unique index enforcing one active share per session
// (migration 015). Its 23505 means "someone else just shared this
// session", not a slug collision — handled by re-reading, not retrying.
const ACTIVE_SHARE_INDEX = 'idx_session_shares_session_active';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // Share builds a full snapshot (queries scan + corpus rehydration) —
  // cheap to debounce, pointless to hammer.
  const rl = await rateLimit(user.id, 'share', 3);
  if (!rl.allowed) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const { id } = await params;

  // Ownership — 404 not 403, same as every session route, so we don't
  // leak whether the id exists for someone else.
  const session = await one<{
    id: string;
    title: string | null;
    voice: string;
    mode: 'chat' | 'study';
    study_text_id: string | null;
  }>(
    `SELECT id, title, voice, mode, study_text_id FROM sessions WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const existing = await one<{ slug: string; created_at: string }>(
    `SELECT slug, created_at FROM session_shares
     WHERE session_id = $1 AND revoked_at IS NULL`,
    [id]
  );
  if (existing) {
    return Response.json({
      slug: existing.slug,
      url: `/share/${existing.slug}`,
      created_at: existing.created_at,
      reused: true,
    });
  }

  const records = await query<{
    query_text: string;
    response_text: string;
    chunks_used: string[] | null;
    created_at: string;
  }>(
    `SELECT query_text, response_text, chunks_used, created_at
     FROM queries
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [id]
  );
  if (records.length === 0) {
    return Response.json({ error: 'Nothing to share yet' }, { status: 400 });
  }

  const allChunkIds = new Set<string>();
  for (const m of records) {
    if (Array.isArray(m.chunks_used)) {
      for (const cid of m.chunks_used) allChunkIds.add(cid);
    }
  }
  const chunkMap = await rehydrateCitations(Array.from(allChunkIds));

  // Ids the corpus no longer resolves drop out of the snapshot — the same
  // graceful degradation the session view has for stale chunks_used.
  const messages = records.map(m => ({
    query_text: m.query_text,
    response_text: m.response_text,
    created_at: m.created_at,
    citations: Array.isArray(m.chunks_used)
      ? m.chunks_used.map(cid => chunkMap.get(cid)).filter(c => c !== undefined)
      : [],
  }));

  const prefs = await loadPreferences(user.id);
  const retrievalScope: RetrievalScope = {
    scopeMode: prefs.scopeMode,
    blockedTraditions: prefs.blockedTraditions,
    blockedTexts: prefs.blockedTexts,
    whitelistedTraditions: prefs.whitelistedTraditions,
    whitelistedTexts: prefs.whitelistedTexts,
  };

  for (let attempt = 0; attempt < SLUG_INSERT_ATTEMPTS; attempt++) {
    const slug = randomBytes(16).toString('base64url');
    try {
      const row = await one<{ slug: string; created_at: string }>(
        `INSERT INTO session_shares
           (slug, session_id, user_id, title, messages, voice, mode, study_text_id, retrieval_scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING slug, created_at`,
        [
          slug,
          id,
          user.id,
          session.title,
          JSON.stringify(messages), // arrays must be stringified for jsonb — pg would treat a bare array as text[]
          session.voice,
          session.mode,
          session.study_text_id,
          JSON.stringify(retrievalScope),
        ]
      );
      return Response.json(
        { slug: row!.slug, url: `/share/${row!.slug}`, created_at: row!.created_at, reused: false },
        { status: 201 }
      );
    } catch (err) {
      const { code: pgCode, constraint } = err as { code?: string; constraint?: string };
      if (pgCode === '23505' && constraint === ACTIVE_SHARE_INDEX) {
        // Lost a race with a concurrent POST for the same session — the
        // idempotency contract says return the winner's link.
        const winner = await one<{ slug: string; created_at: string }>(
          `SELECT slug, created_at FROM session_shares
           WHERE session_id = $1 AND revoked_at IS NULL`,
          [id]
        );
        if (winner) {
          return Response.json({
            slug: winner.slug,
            url: `/share/${winner.slug}`,
            created_at: winner.created_at,
            reused: true,
          });
        }
        continue; // winner already revoked again — our next attempt can land
      }
      if (pgCode === '23505') continue; // slug collision — mint another
      throw err;
    }
  }
  // 3 consecutive 128-bit collisions means something is broken, not unlucky.
  return Response.json({ error: 'Could not allocate share link' }, { status: 500 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const { id } = await params;

  // Ownership rides on session_shares.user_id, so revoke keeps working
  // even after the source session row is deleted (session_id NULL).
  const revoked = await query<{ id: string }>(
    `UPDATE session_shares SET revoked_at = now()
     WHERE session_id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [id, user.id]
  );
  if (revoked.length === 0) {
    return Response.json({ error: 'No active share' }, { status: 404 });
  }
  return Response.json({ revoked: true });
}
