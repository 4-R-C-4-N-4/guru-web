/**
 * src/app/api/query/route.ts
 *
 * POST /api/query — core query endpoint.
 *
 * Flow:
 *   1. Auth check (requireUser)
 *   1b. Rate limit (1s per-user min interval)
 *   2. Parse + validate body
 *   2b. Session ownership check
 *   3. Retrieve + build prompt
 *   4. Estimate cost (worst-case: input + MAX_OUTPUT_TOKENS) and reserve
 *      budget atomically across both axes (todo:7c8fdae7).  Reject 429
 *      with reason when over query or USD limit.
 *   5. Stream LLM response back to client.
 *   6. Compute actual cost from usage chunk; reconcile with finalize.
 *   7. Persist query row with cost_usd + cached_input_tokens.
 */

import { requireUser } from '@/lib/auth';
import { retrieve } from '@/lib/retriever';
import { buildPrompt, SYSTEM_PROMPT } from '@/lib/prompt';
import { completeStream, MAX_OUTPUT_TOKENS } from '@/lib/model';
import {
  DEFAULT_CURATED_SLUG,
  isCuratedSlug,
  resolveCuratedModel,
} from '@/lib/curated-models';
import { reserveBudget, finalizeBudget } from '@/lib/spend';
import { computeCost } from '@/lib/cost';
import { loadPreferences } from '@/lib/prefs';
import { rateLimit } from '@/lib/rate-limit';
import { one, exec } from '@/lib/db';

export const runtime = 'nodejs';

const MAX_QUERY_CHARS = 4000;

export async function POST(req: Request) {
  // 1. Auth
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  // 1b. Rate limit — 1s per-user min-interval debounce.
  const rl = await rateLimit(user.id, 'query', 1);
  if (!rl.allowed) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

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

  // Hard cap so a 10MB POST can't reach the embedder + LLM. 4000 chars ~ 1000
  // tokens — well within every downstream limit; cap is purely an abuse gate.
  // No truncation: silently rewriting user input changes their intent.
  if (queryText.length > MAX_QUERY_CHARS) {
    return Response.json(
      { error: `query exceeds ${MAX_QUERY_CHARS}-character limit`, limit: MAX_QUERY_CHARS, length: queryText.length },
      { status: 400 },
    );
  }

  // 2b. Ownership check — if the client supplied a sessionId, confirm it
  // belongs to the authenticated user before we do any work or persist into it.
  // Returns 404 (not 403) so we don't leak whether a session exists for someone else.
  if (sessionId) {
    const owned = await one<{ id: string }>(
      `SELECT id FROM sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, user.id]
    );
    if (!owned) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
  }

  // 3. Retrieve + build prompt (before budget reservation — failed retrieval
  // shouldn't consume quota)
  const prefs = await loadPreferences(user.id);
  const chunks = await retrieve(queryText, prefs);
  const prompt = buildPrompt(queryText, chunks, prefs, user.tier);

  // 4. Estimate cost + reserve budget atomically.
  // Estimate is intentionally a worst-case ceiling: assumed input tokens
  // from prompt+system char count, output capped at MAX_OUTPUT_TOKENS.
  // finalizeBudget reconciles to the actual cost from the usage chunk.
  //
  // Model resolution: pro consults user_preferences.preferred_model
  // (a CURATED_MODELS slug); free is always pinned to the default.
  // A pro user with no preference saved, or a stale slug from before
  // a rename, falls back to DEFAULT_CURATED_SLUG. Spec:
  // BRD-model-selection.md §7.2.
  const slug = user.tier === 'pro' && isCuratedSlug(prefs.preferredModel)
    ? prefs.preferredModel
    : DEFAULT_CURATED_SLUG;
  const modelId = resolveCuratedModel(slug);
  const estimatedInputTokens = Math.ceil((SYSTEM_PROMPT.length + prompt.length) / 4);
  const { cost_usd: estimatedCostUsd } = await computeCost({
    modelId,
    inputTokens: estimatedInputTokens,
    outputTokens: MAX_OUTPUT_TOKENS,
  });

  const reserve = await reserveBudget({
    userId: user.id,
    tier: user.tier,
    estimatedCostUsd,
  });
  if (!reserve.allowed) {
    return Response.json(
      {
        error: reserve.reason === 'usd'
          ? 'Daily spend limit reached'
          : 'Daily query limit reached',
        reason: reserve.reason,
        queries_used: reserve.queries_used,
        query_limit:  reserve.query_limit,
        usd_used:     reserve.usd_used,
        usd_limit:    reserve.usd_limit,
      },
      { status: 429 },
    );
  }

  // 5. Stream — completeStream takes the resolved model id (BRD §7.2).
  const stream = await completeStream(prompt, modelId);

  let fullResponse = '';
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cachedInputTokens = 0;
  let streamError: Error | null = null;

  const readable = new ReadableStream({
    async start(controller) {
      // Idempotent close: the controller can already be closed/errored if
      // the client disconnects mid-stream or the upstream LLM stream errors.
      // A throw here would skip the persistence block below.
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed/errored */ }
      };

      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? '';
          if (text) {
            fullResponse += text;
            try {
              controller.enqueue(new TextEncoder().encode(text));
            } catch {
              // Client disconnected; stop iterating. Partial response is
              // still in fullResponse and gets persisted below.
              break;
            }
          }
          if (chunk.usage) {
            inputTokens  = chunk.usage.prompt_tokens     ?? null;
            outputTokens = chunk.usage.completion_tokens ?? null;
            // Cached-token field name varies by provider through OpenRouter:
            //   OpenAI:    prompt_tokens_details.cached_tokens
            //   Anthropic: cache_read_input_tokens (sometimes top-level)
            // Cast loosely so we read whichever the provider supplied.
            const u = chunk.usage as {
              prompt_tokens_details?: { cached_tokens?: number };
              cache_read_input_tokens?: number;
            };
            cachedInputTokens =
              u.prompt_tokens_details?.cached_tokens ??
              u.cache_read_input_tokens ??
              0;
          }
        }
      } catch (err) {
        streamError = err instanceof Error ? err : new Error(String(err));
        console.error('[api/query] stream error:', streamError);
      } finally {
        safeClose();
      }

      // 6. Compute actual cost + reconcile budget.
      // If usage chunk never arrived (truncation / upstream abort), leave
      // the estimate locked in usd_used and persist cost_usd as NULL —
      // honest about not knowing.
      let costUsd: number | null = null;
      if (inputTokens !== null && outputTokens !== null) {
        try {
          const { cost_usd } = await computeCost({
            modelId,
            inputTokens,
            outputTokens,
            cachedInputTokens,
          });
          costUsd = cost_usd;
          await finalizeBudget({
            userId: user.id,
            estimatedCostUsd,
            actualCostUsd: cost_usd,
          });
        } catch (err) {
          console.error('[api/query] cost reconciliation failed:', err);
        }
      }

      // 7. Persist after stream closes — save partial response on error.
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
              chunks_used, model_used, tier_used,
              input_tokens, output_tokens, cached_input_tokens, cost_usd)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            sessionId,
            user.id,
            queryText,
            fullResponse,
            JSON.stringify(chunks.map(c => c.id)),
            modelId,
            user.tier,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            costUsd,
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
      'X-Quota-Used':  String(reserve.queries_used),
      'X-Quota-Limit': String(reserve.query_limit ?? 'unlimited'),
      'X-Spend-Used':  String(reserve.usd_used),
      'X-Spend-Limit': String(reserve.usd_limit ?? 'unlimited'),
      // Resolved model id, so the client can render the per-response
      // attribution line (model-selection BRD §7.4) the moment the
      // stream opens — without waiting for a session-reload to pull
      // the row through recordsToMessages. Tokens + cost are still
      // null until persistence + finalizeBudget complete; they fill
      // in on the next session fetch. We expose just the model name
      // in-session, since it's known up-front and is the most useful
      // bit ("which model wrote this answer").
      'X-Model-Used':  modelId,
      ...(streamError ? { 'X-Stream-Error': 'truncated' } : {}),
    },
  });
}
