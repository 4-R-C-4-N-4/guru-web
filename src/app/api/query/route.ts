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
 *   4. Estimate cost (typical-case: input + TYPICAL_OUTPUT_TOKENS) and
 *      reserve budget atomically across both axes (todo:7c8fdae7).
 *      Reject 429 with reason when over query or USD limit.
 *   5. Stream LLM response back to client.
 *   6. Compute actual cost from usage chunk; reconcile with finalize.
 *   7. Persist query row with cost_usd + cached_input_tokens.
 */

import { requireUser } from '@/lib/auth';
import { retrieve } from '@/lib/retriever';
import { summarizeExpansion } from '@/lib/graph';
import { buildPrompt, buildStudyPrompt, getSystemPrompt, DEFAULT_VOICE, isVoiceSlug } from '@/lib/prompt';
import type { VoiceSlug } from '@/lib/types';
import { completeStream } from '@/lib/model';
import { loadSessionHistory, type ChatMessage } from '@/lib/history';
import { getDossierForText } from '@/lib/dossier';
import {
  DEFAULT_CURATED_SLUG,
  isCuratedSlug,
  resolveCuratedModel,
} from '@/lib/curated-models';
import { TYPICAL_OUTPUT_TOKENS } from '@/lib/pricing-config';
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
  // Also pulls session.voice (snapshotted at session creation) so the system
  // prompt this turn matches the voice the thread was started under.
  // Spec: BRD-chat-voice.md §5.
  let sessionVoice: string | null = null;
  let sessionMode: 'chat' | 'study' = 'chat';
  let studyTextId: string | null = null;
  if (sessionId) {
    const owned = await one<{ id: string; voice: string; mode: 'chat' | 'study'; study_text_id: string | null }>(
      `SELECT id, voice, mode, study_text_id FROM sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, user.id]
    );
    if (!owned) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    sessionVoice = owned.voice;
    sessionMode = owned.mode ?? 'chat';
    studyTextId = owned.study_text_id;
  }

  // 3. Retrieve + build prompt (before budget reservation — failed retrieval
  // shouldn't consume quota)
  const prefs = await loadPreferences(user.id);

  // Load prior turns so the model can resolve referents like "it" / "that"
  // across turns. Empty when no sessionId (auto-create path) — the first
  // turn has no history by definition. Pruning caps live in history.ts.
  // Spec: BRD-conversation-continuity §4.5.
  const history = sessionId
    ? await loadSessionHistory(sessionId, { maxTurns: 6, maxTokens: 4000 })
    : [];
  const historyChars  = history.reduce((n, m) => n + m.content.length, 0);
  const historyTokens = Math.ceil(historyChars / 4);

  // Retrieve and summarise the query expansion in parallel — the expansion
  // summary feeds the X-Query-Expansion transparency header (todo:9d2ad427) and
  // is independent of the chunk fetch, so it adds no latency.
  // Study sessions (summary-phase-w.md §W5) add the summary retrieval leg
  // (W3) and the work dossier (W4); the dossier fetch is one PK-shaped query
  // and independent of retrieval, so it joins the parallel batch.
  const isStudy = sessionMode === 'study' && !!studyTextId;
  const [chunks, expansion, dossier] = await Promise.all([
    isStudy
      ? retrieve(queryText, prefs, 15, 'study', studyTextId)
      : retrieve(queryText, prefs),
    summarizeExpansion(queryText),
    isStudy ? getDossierForText(studyTextId!) : Promise.resolve(null),
  ]);
  // Reserve room for history in the chunk-fitting budget so long sessions
  // retrieve fewer chunks rather than blowing the context window.
  const prompt = isStudy
    ? buildStudyPrompt(queryText, chunks, dossier, prefs, user.tier, historyTokens)
    : buildPrompt(queryText, chunks, prefs, user.tier, historyTokens);

  // 4. Estimate cost + reserve budget atomically.
  //
  // Reservation estimate uses TYPICAL_OUTPUT_TOKENS, not MAX_OUTPUT_TOKENS.
  // The two serve different purposes:
  //
  //   MAX_OUTPUT_TOKENS (8192)  — the API-ceiling we pass to OpenRouter as
  //                                max_tokens. Hard cap so verbose responses
  //                                don't truncate mid-citation. Stays.
  //   TYPICAL_OUTPUT_TOKENS (2k) — the budget-reservation estimate. Calibrated
  //                                from real production data: real responses
  //                                land at ~1-3k tokens, well below the API
  //                                ceiling.
  //
  // Reserving at MAX bricked the picker UX: an Anthropic user picks the
  // option that promises ~2 queries/day, does 1 query (actual ~$0.07),
  // tries Q2 — reservation worst-case ($0.15) won't fit alongside $0.07
  // already used → 429 after 1 query, not 2. todo:843e00ad.
  //
  // Risk: if a single response IS verbose (8k output, $0.15 actual), the
  // delta over typical ($0.06 reservation) gets added to usd_used by
  // finalizeBudget. Subsequent reservations correctly reject; operator
  // absorbs the per-query overshoot. Bounded at ~$0.10 per blown query,
  // small at pre-launch scale.
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

  // Voice resolution: an existing session's voice is whatever was
  // snapshotted at its creation — including 'woowoo' for a user whose
  // tier has since flipped to free (thread coherence wins; the prior
  // turns were generated under that voice). For a new session the
  // tier gate applies: free users always snapshot to scholar
  // regardless of their stored preference.
  // Spec: BRD-chat-voice.md §5, §6.
  const newSessionVoice: VoiceSlug =
    user.tier === 'pro' && isVoiceSlug(prefs.preferredVoice)
      ? prefs.preferredVoice
      : DEFAULT_VOICE;
  const voice: VoiceSlug =
    sessionVoice !== null && isVoiceSlug(sessionVoice)
      ? sessionVoice
      : newSessionVoice;

  // Compose once and reuse — both the token estimate and the streamed
  // message read from the same string.
  const systemPrompt = getSystemPrompt(voice);
  const estimatedInputTokens = Math.ceil(
    (systemPrompt.length + historyChars + prompt.length) / 4,
  );
  const { cost_usd: estimatedCostUsd } = await computeCost({
    modelId,
    inputTokens: estimatedInputTokens,
    outputTokens: TYPICAL_OUTPUT_TOKENS,
  });

  const reserve = await reserveBudget({
    userId: user.id,
    tier: user.tier,
    estimatedCostUsd,
  });
  if (!reserve.allowed) {
    // Unified user-facing message regardless of which axis bound. The
    // USD cap is intentionally hidden from the user — it still enforces
    // and the `reason` field stays in the response for log/admin
    // telemetry, but we don't surface 'spend' as user-facing language
    // (todo:e8105324). Both axes feel like 'I ran out of questions
    // today.'
    return Response.json(
      {
        error: 'Daily question limit reached. Resets at midnight UTC.',
        reason: reserve.reason,
        queries_used: reserve.queries_used,
        query_limit:  reserve.query_limit,
        usd_used:     reserve.usd_used,
        usd_limit:    reserve.usd_limit,
      },
      { status: 429 },
    );
  }

  // 5. Stream — system + prior turns + new user message. The history
  // gives the model the context to resolve referents like "it" across
  // turns. Spec: BRD-conversation-continuity §4.5.
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user',   content: prompt },
  ];
  const stream = await completeStream(messages, modelId, slug);

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

      // When the client socket goes away we stop pushing bytes (the socket is
      // dead) but KEEP draining the upstream stream to completion — generation
      // finishes server-side, so the full response + real usage still get
      // persisted and billed. Matches the ChatGPT-style expectation that an
      // answer completes even if the user navigated away. (todo:38fb34db)
      let clientGone = false;
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? '';
          if (text) {
            fullResponse += text;
            if (!clientGone) {
              try {
                controller.enqueue(new TextEncoder().encode(text));
              } catch {
                // Client disconnected. Stop enqueuing, but DON'T break: keep
                // consuming so the upstream stream runs to completion and the
                // final usage chunk still arrives.
                clientGone = true;
              }
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
      // The usage chunk arrives at the natural end of the stream — including
      // when the client has already disconnected, since we drain to completion
      // above. It's absent only on a genuine upstream failure (the for-await
      // threw); in that case leave the estimate locked in usd_used and persist
      // cost_usd as NULL — honest about not knowing.
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
          // Auto-create a session if none provided. Snapshot the resolved
          // voice (already gated on tier above) onto the row so future
          // turns on this thread read back the same value.
          // Spec: BRD-chat-voice.md §5.
          const sessionRow = await one<{ id: string }>(
            `INSERT INTO sessions (user_id, title, voice, created_at, updated_at)
             VALUES ($1, $2, $3, now(), now())
             RETURNING id`,
            [user.id, queryText.slice(0, 80), voice]
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

  // Authoritative citations for the LIVE render. The chat client used to
  // recover citations by parsing the model's free-text CITATIONS tail out of
  // the stream — fragile, since the model varies that format (inline quotes,
  // index-prefixed/unbracketed entries, sometimes omitting the block under the
  // output-token cap), so cards frequently failed to appear until a refresh
  // rehydrated them from chunks_used. These ARE the chunks_used rows (same set
  // /api/sessions/[id] rehydrates on refresh), so the client gets identical,
  // model-format-independent citations the moment the stream opens — no refresh
  // needed (todo:2fd21c61). URI-encoded JSON keeps the header ASCII-safe.
  const citationsHeader = chunks.length > 0
    ? encodeURIComponent(JSON.stringify(
        chunks.map(c => ({
          tradition: c.tradition,
          text: c.text_name,
          section: c.section,
          tier: c.tier ?? 'verified',
        })),
      ))
    : '';

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
      // Query-expansion transparency (todo:9d2ad427): the family/domain matches
      // that fanned this query out, so the client can show "matched X → N
      // concepts". URI-encoded JSON keeps the header ASCII-safe; omitted when
      // nothing expanded (concept-only / no match) so no chip renders.
      ...(expansion.length > 0 && { 'X-Query-Expansion': encodeURIComponent(JSON.stringify(expansion)) }),
      ...(citationsHeader && { 'X-Citations': citationsHeader }),
      ...(streamError ? { 'X-Stream-Error': 'truncated' } : {}),
    },
  });
}
