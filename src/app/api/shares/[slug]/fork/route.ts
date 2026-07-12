/**
 * src/app/api/shares/[slug]/fork/route.ts
 *
 * POST /api/shares/[slug]/fork — copy a public share's snapshot into a
 * new session owned by the (authenticated) caller, so they can continue
 * the conversation from the shared point (todo:e13dd999, parent
 * todo:36421ff5).
 *
 * Settings persist: mode/study_text_id/title copy from the snapshot, and
 * the frozen retrieval scope lands in sessions.scope_override so the
 * query route keeps retrieving under the scope the original conversation
 * was held under.
 *
 * Voice is say-but-downgrade: a fork is a NEW session, so the
 * creation-time tier gate applies (BRD-chat-voice §6, same rule the
 * query route uses for new sessions) — a non-pro forker gets
 * DEFAULT_VOICE instead of a pro voice, and the response reports the
 * downgrade so the UI can surface it. §5 immutability still holds from
 * this point on: the forked session's voice never changes again.
 * (Model needs no equivalent: it is never snapshotted — the forker's
 * own tier drives model selection on every future turn.)
 *
 * Accounting is ZEROED on the copied turns: tokens 0, cost_usd 0,
 * model/tier NULL (queries.model_used/tier_used made nullable in 015).
 * The tokens were never re-generated — carrying the owner's numbers
 * would double-count real spend in any SUM over queries, and NULL cost
 * with real token counts would get "re-priced" by
 * scripts/backfill-cost.ts (NULL cost_usd marks a backfillable row).
 * Zero tokens re-price to $0 even if the backfill runs. user_budgets is
 * untouched — forking consumes no quota; the forker starts paying
 * normally from their next live turn.
 *
 * The session INSERT and the per-turn queries INSERT run as one
 * data-modifying CTE — a single statement, so a failure anywhere rolls
 * the whole fork back instead of stranding an empty session.
 *
 * chunks_used gets the bare chunk ids extracted from the snapshot's rich
 * citations — the exact shape live turns persist — so the session view's
 * rehydration path treats forked turns like any others.
 */

import { requireUser } from '@/lib/auth';
import { one } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { getShareBySlug } from '@/lib/chat-public';
import { DEFAULT_VOICE } from '@/lib/prompt';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // Each fork writes a session + N queries rows — debounce harder than
  // the 1s query limiter.
  const rl = await rateLimit(user.id, 'fork', 10);
  if (!rl.allowed) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const { slug } = await params;

  // getShareBySlug already filters revoked shares — unknown and revoked
  // 404 identically, nothing to leak.
  const share = await getShareBySlug(slug);
  if (!share) {
    return Response.json({ error: 'Share not found' }, { status: 404 });
  }

  const voice = user.tier === 'pro' ? share.voice : DEFAULT_VOICE;

  // Original turn timestamps are preserved so ordering (ORDER BY
  // created_at) matches what the share page showed. Zeroed-accounting
  // literals live in the SQL, not params — there is no code path that
  // forks with real numbers.
  const turns = share.messages.map(m => ({
    query_text: m.query_text,
    response_text: m.response_text,
    chunks_used: m.citations.map(c => c.id),
    created_at: m.created_at,
  }));

  const sessionRow = await one<{ id: string }>(
    `WITH s AS (
       INSERT INTO sessions
         (user_id, title, voice, mode, study_text_id,
          scope_override, forked_from_share_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
       RETURNING id
     ), q AS (
       INSERT INTO queries
         (session_id, user_id, query_text, response_text, chunks_used,
          model_used, tier_used, input_tokens, output_tokens,
          cached_input_tokens, cost_usd, created_at)
       SELECT s.id, $1, t.query_text, t.response_text, t.chunks_used,
              NULL, NULL, 0, 0, 0, 0, t.created_at
       FROM s, jsonb_to_recordset($8::jsonb)
         AS t(query_text TEXT, response_text TEXT, chunks_used JSONB, created_at TIMESTAMPTZ)
     )
     SELECT id FROM s`,
    [
      user.id,
      share.title,
      voice,
      share.mode,
      share.study_text_id,
      JSON.stringify(share.retrieval_scope),
      share.id,
      JSON.stringify(turns),
    ]
  );
  if (!sessionRow) {
    return Response.json({ error: 'Fork failed' }, { status: 500 });
  }

  return Response.json(
    {
      sessionId: sessionRow.id,
      voice,
      ...(voice !== share.voice
        ? { voiceDowngraded: { from: share.voice, to: voice } }
        : {}),
    },
    { status: 201 }
  );
}
