/**
 * src/app/api/sessions/route.ts
 *
 * GET  /api/sessions — list user's sessions (newest first, paginated)
 * POST /api/sessions — create a new session
 */

import { requireUser } from '@/lib/auth';
import { query, one, exec } from '@/lib/db';
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

  const session = await one<Session>(
    `INSERT INTO sessions (user_id, title, created_at, updated_at)
     VALUES ($1, $2, now(), now())
     RETURNING id, title, created_at, updated_at`,
    [user.id, title]
  );

  return Response.json(session, { status: 201 });
}
