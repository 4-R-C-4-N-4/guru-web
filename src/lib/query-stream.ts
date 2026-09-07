/**
 * src/lib/query-stream.ts
 *
 * Shared answer-streaming machinery for the query endpoints (todo:732e73b1).
 *
 * Both /api/query (authenticated) and /api/query/guest need the same
 * delicate streaming contract:
 *   - enqueue model deltas to the client as they arrive;
 *   - if the client socket goes away mid-stream, STOP enqueuing but KEEP
 *     draining upstream to completion so the full response + real usage
 *     still land (ChatGPT-style "answer finishes even if you navigated
 *     away", todo:38fb34db);
 *   - close the controller exactly once (idempotent);
 *   - after the stream ends, compute actual cost from the usage chunk and
 *     hand everything to an onComplete callback for cost reconciliation +
 *     persistence — which is the ONLY part that differs between the authed
 *     and guest paths.
 *
 * Keeping this in one place stops the two routes from drifting. The caller
 * still owns opening the upstream stream (so a failure to open surfaces as
 * a 500 before any Response is returned) and building the Response headers
 * (all known up-front: model id, citations, quota).
 */

import { computeCost } from './cost';

/** Minimal shape of an OpenRouter streaming chunk we read. */
interface StreamChunk {
  choices: { delta?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    prompt_tokens_details?: { cached_tokens?: number | null } | null;
    cache_read_input_tokens?: number | null;
  } | null;
}

export interface CompletedGeneration {
  fullResponse: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number;
  /** Actual cost; null when the usage chunk was absent or cost calc failed. */
  costUsd: number | null;
  /** True when the upstream stream threw mid-generation. */
  streamError: boolean;
}

/**
 * Build the client-facing ReadableStream. `stream` is the already-opened
 * upstream completion (from completeStream). `modelId` prices the usage.
 * `onComplete` runs once after the stream ends — persist + finalize there.
 */
export function buildAnswerStream(opts: {
  stream: AsyncIterable<StreamChunk>;
  modelId: string;
  logTag: string;
  onComplete: (g: CompletedGeneration) => Promise<void>;
}): ReadableStream<Uint8Array> {
  const { stream, modelId, logTag, onComplete } = opts;

  return new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed/errored */ }
      };

      let fullResponse = '';
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      let cachedInputTokens = 0;
      let streamError = false;
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
                // Client disconnected. Stop enqueuing but keep consuming so
                // the upstream stream runs to completion and the final usage
                // chunk still arrives.
                clientGone = true;
              }
            }
          }
          if (chunk.usage) {
            inputTokens  = chunk.usage.prompt_tokens     ?? null;
            outputTokens = chunk.usage.completion_tokens ?? null;
            // Cached-token field name varies by provider through OpenRouter.
            const u = chunk.usage;
            cachedInputTokens =
              u.prompt_tokens_details?.cached_tokens ??
              u.cache_read_input_tokens ??
              0;
          }
        }
      } catch (err) {
        streamError = true;
        console.error(`[${logTag}] stream error:`, err);
      } finally {
        safeClose();
      }

      // Compute actual cost from usage. Absent only on a genuine upstream
      // failure (the for-await threw before the usage chunk); leave null then.
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
        } catch (err) {
          console.error(`[${logTag}] cost compute failed:`, err);
        }
      }

      try {
        await onComplete({
          fullResponse,
          inputTokens,
          outputTokens,
          cachedInputTokens,
          costUsd,
          streamError,
        });
      } catch (err) {
        // Persistence must never surface to the client — the response is
        // already streamed. Log and move on.
        console.error(`[${logTag}] onComplete error:`, err);
      }
    },
  });
}
