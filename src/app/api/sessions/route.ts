/**
 * src/app/api/sessions/route.ts
 *
 * GET  /api/sessions — list user's sessions (newest first, paginated)
 * POST /api/sessions — create a new session
 */

import { requireUser } from '@/lib/auth';
import { query, one } from '@/lib/db';
import { loadPreferences } from '@/lib/prefs';
import { DEFAULT_VOICE, isVoiceSlug } from '@/lib/prompt';
import type { Session } from '@/lib/types';

export async function GET(req: Request) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const { searchParams } = new URL(req.url);
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '20', 10), 100);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0',  10), 0);

  const sessions = await query<Session>(
    `SELECT id, title, created_at, updated_at
     FROM sessions
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT $2 OFFSET $3`,
    [user.id, limit, offset]
  );

  const countRow = await one<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM sessions WHERE user_id = $1`,
    [user.id]
  );

  return Response.json({
    sessions,
    total: parseInt(countRow?.count ?? '0', 10),
    limit,
    offset,
  });
}

export async function POST(req: Request) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  let title: string | null = null;
  try {
    const body = await req.json() as { title?: unknown };
    title = typeof body.title === 'string' ? body.title.slice(0, 255) : null;
  } catch {
    // title is optional — empty body is fine
  }

  // Snapshot the user's preferred voice onto the new session row. Free
  // users always snapshot to scholar regardless of stored preference;
  // pro users get whichever voice they've set (defaulting to scholar
  // when unset or stored as an unknown slug). The snapshot is immutable
  // for the life of the session — a later profile-voice change does not
  // re-skin existing threads. Spec: BRD-chat-voice.md §5.
  const prefs = await loadPreferences(user.id);
  const voice =
    user.tier === 'pro' && isVoiceSlug(prefs.preferredVoice)
      ? prefs.preferredVoice
      : DEFAULT_VOICE;

  const session = await one<Session>(
    `INSERT INTO sessions (user_id, title, voice, created_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     RETURNING id, title, created_at, updated_at`,
    [user.id, title, voice]
  );

  return Response.json(session, { status: 201 });
}
