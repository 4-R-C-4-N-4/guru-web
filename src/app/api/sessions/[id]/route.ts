/**
 * src/app/api/sessions/[id]/route.ts
 *
 * GET /api/sessions/[id] — get a session with its messages (queries)
 */

import { requireUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import type { QueryRecord, Session } from '@/lib/types';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const { id } = await params;

  const session = await one<Session>(
    `SELECT id, title, created_at, updated_at
     FROM sessions
     WHERE id = $1 AND user_id = $2`,
    [id, user.id]
  );

  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const messages = await query<QueryRecord>(
    `SELECT id, query_text, response_text, chunks_used, model_used, created_at
     FROM queries
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [id]
  );

  return Response.json({ session, messages });
}
