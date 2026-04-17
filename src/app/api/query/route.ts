/**
 * src/app/api/query/route.ts
 *
 * POST /api/query — core query endpoint.
 *
 * Flow:
 *   1. Auth check (requireUser)
 *   2. Quota check + atomic increment (checkAndIncrement)
 *   3. Load user preferences
 *   4. Hybrid retrieval (retrieve)
 *   5. Build prompt (buildPrompt)
 *   6. Stream LLM response back to client
 *   7. Persist full response + metadata after stream closes
 */

import { requireUser } from '@/lib/auth';
import { retrieve } from '@/lib/retriever';
import { buildPrompt } from '@/lib/prompt';
import { completeStream, MODELS } from '@/lib/model';
import { checkAndIncrement } from '@/lib/quota';
import { loadPreferences } from '@/lib/prefs';
import { one, exec } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // 1. Auth
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // 2. Parse body
  let queryText: string;
  let sessionId: string | null;
  try {
    const body = await req.json() as { query?: unknown; sessionId?: unknown };
    if (typeof body.query !== 'string' || !body.query.trim()) {
      return Response.json({ error: 'query is required' }, { status: 400 });
    }
    queryText = body.query.trim();
    sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // 3. Retrieve + build prompt (before quota consumption)
  const prefs = await loadPreferences(user.id);
  const chunks = await retrieve(queryText, prefs);
  const prompt = buildPrompt(queryText, chunks, prefs, user.tier);

  // 4. Quota check (after retrieval succeeds — failed queries shouldn't consume quota)
  const quota = await checkAndIncrement(user.id, user.tier);
  if (!quota.allowed) {
    return Response.json(
      { error: 'Daily query limit reached', used: quota.used, limit: quota.limit },
      { status: 429 }
    );
  }

  // 5. Stream
  const stream = await completeStream(prompt, user.tier);

  let fullResponse = '';
  let streamError: Error | null = null;

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? '';
          if (text) {
            fullResponse += text;
            controller.enqueue(new TextEncoder().encode(text));
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
        console.error('[api/query] stream error:', streamError);
      } finally {
        controller.close();
      }

      // 6. Persist after stream closes — save partial response on error
      const model = MODELS[user.tier];
      try {
        if (!sessionId) {
          // Auto-create a session if none provided
          const sessionRow = await one<{ id: string }>(
            `INSERT INTO sessions (user_id, title, created_at, updated_at)
             VALUES ($1, $2, now(), now())
             RETURNING id`,
            [user.id, queryText.slice(0, 80)]
          );
          if (sessionRow) sessionId = sessionRow.id;
        }

        await exec(
          `INSERT INTO queries
             (session_id, user_id, query_text, response_text,
              chunks_used, model_used, tier_used)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            sessionId,
            user.id,
            queryText,
            fullResponse,
            JSON.stringify(chunks.map(c => c.id)),
            model,
            user.tier,
          ]
        );
      } catch (err) {
        // Persistence failure should not surface to the client — the response
        // is already streamed. Log and move on.
        console.error('[api/query] persist error:', err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Quota-Used':  String(quota.used),
      'X-Quota-Limit': String(quota.limit),
      ...(streamError ? { 'X-Stream-Error': 'truncated' } : {}),
    },
  });
}
