/**
 * src/app/api/shares/[slug]/fork/route.ts
 *
 * POST /api/shares/[slug]/fork — copy a public share's snapshot into a
 * new session owned by the (authenticated) caller, so they can continue
 * the conversation from the shared point (todo:e13dd999, parent
 * todo:36421ff5).
 *
 * Settings persist: voice/mode/study_text_id/title copy from the
 * snapshot, and the frozen retrieval scope lands in
 * sessions.scope_override so the query route keeps retrieving under the
 * scope the original conversation was held under. Voice is deliberately
 * NOT re-gated on the forker's tier — an existing session's voice is
 * immutable by doctrine (BRD-chat-voice §5), and a fork *is* an existing
 * conversation.
 *
 * Accounting is ZEROED on the copied turns: tokens 0, cost_usd 0,
 * model/tier NULL. The tokens were never re-generated — carrying the
 * owner's numbers would double-count real spend in any SUM over queries,
 * and NULL cost with real token counts would get "re-priced" by
 * scripts/backfill-cost.ts (NULL cost_usd marks a backfillable row).
 * Zero tokens re-price to $0 even if the backfill runs. user_budgets is
 * untouched — forking consumes no quota; the forker starts paying
 * normally from their next live turn.
 *
 * chunks_used gets the bare chunk ids extracted from the snapshot's rich
 * citations — the exact shape live turns persist — so the session view's
 * rehydration path treats forked turns like any others.
 */

import { requireUser } from '@/lib/auth';
import { one, exec } from '@/lib/db';
import { getShareBySlug } from '@/lib/chat-public';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const { slug } = await params;

  // getShareBySlug already filters revoked shares — unknown and revoked
  // 404 identically, nothing to leak.
  const share = await getShareBySlug(slug);
  if (!share) {
    return Response.json({ error: 'Share not found' }, { status: 404 });
  }

  const sessionRow = await one<{ id: string }>(
    `INSERT INTO sessions
       (user_id, title, voice, mode, study_text_id,
        scope_override, forked_from_share_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
     RETURNING id`,
    [
      user.id,
      share.title,
      share.voice,
      share.mode,
      share.study_text_id,
      JSON.stringify(share.retrieval_scope),
      share.id,
    ]
  );
  if (!sessionRow) {
    return Response.json({ error: 'Fork failed' }, { status: 500 });
  }

  // Original turn timestamps are preserved so ordering (ORDER BY
  // created_at) matches what the share page showed. Zeroed-accounting
  // literals live in the SQL, not params — there is no code path that
  // forks with real numbers.
  for (const m of share.messages) {
    await exec(
      `INSERT INTO queries
         (session_id, user_id, query_text, response_text, chunks_used,
          model_used, tier_used, input_tokens, output_tokens,
          cached_input_tokens, cost_usd, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, 0, 0, 0, 0, $6)`,
      [
        sessionRow.id,
        user.id,
        m.query_text,
        m.response_text,
        JSON.stringify(m.citations.map(c => c.id)),
        m.created_at,
      ]
    );
  }

  return Response.json({ sessionId: sessionRow.id }, { status: 201 });
}
