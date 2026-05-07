# BRD — Multi-Turn Conversation Continuity (Phase 1)

Source: a real production session (`c9968a13`, 2026-05-06). The user
asked *"Talk to me about Neoplatonism, is this tradition similar to
Christianity?"* and followed up with *"So it is more similar to
Gnosticism."* The model's second response opened with: *"You have
posed a compact query, and its antecedent is unstated here, so I
must infer from the materials you have provided what 'it' might
be."*

The model did not have access to the prior turn. Token math
confirms: query 1 sent 8,389 input tokens (system + chunks + query);
query 2 sent 2,741 — *less* than query 1, when conversation replay
would have made it larger. Each turn is a standalone API call.
There is no within-session memory.

This BRD specifies the minimum-viable fix: replay prior turns to
the model as a `messages` array. Retrieval rewriting and
long-session pruning are deferred (§8).

Out of scope: any change to retrieval, prompt template, modes, or
the spend/quota system. The fix is one signature change in the
model layer plus a small history-fetch helper in the route.

---

## 1 Decision summary

1. **`completeStream` accepts a messages array**, not a single user
   prompt. The caller assembles `[{system}, ...history, {user: new}]`.
2. **`/api/query` loads prior turns from the `queries` table** for
   the session and threads them into the messages array. No schema
   change required — the table already has `query_text`,
   `response_text`, `created_at` indexed by `(session_id, created_at)`.
3. **History pruning is FIFO**: keep the most recent 6 turns
   (3 user/assistant pairs) or 4,000 history tokens, whichever
   binds first. Drop oldest turns when over either cap.
4. **Token budget reserves room for history.** `buildPrompt` accepts
   a `reservedExtra` token count; long sessions retrieve fewer
   chunks per turn, which is the correct tradeoff.
5. **Retrieval is unchanged for phase 1.** Continues to search on
   the literal new user query. Bad chunks on follow-up turns are
   compensated for by the prior assistant response (which carries
   the prior turn's citations and quotes verbatim) being in the
   conversation history. Phase 2 (rewriter) addresses the residual
   retrieval gap when it earns its complexity.

---

## 2 Why this is not a hack

The OpenAI/Anthropic chat-completions `messages` array is the
platform's native multi-turn interface. claude.ai and ChatGPT pass
full conversation history on every turn within a session; the
"memory" features in those products are *cross-session*, not the
within-session continuity mechanism. There is no shortcut here that
the chatbot platforms have abstracted away — they replay too. They
just rely on prompt caching to make the prefix cheap.

---

## 3 Why not the alternatives

**Concatenating prior queries into the retrieval string.** Rejected.
Silently rewriting user input violates the existing principle in
`src/app/api/query/route.ts:71`: *"No truncation: silently rewriting
user input changes their intent."* Same category of decision.

**Running session summary.** Deferred indefinitely for v1. A summary
costs an extra LLM generation call per turn. With prefix caching
on the dominant providers (deepseek, OpenAI), replay+caching is
*cheaper* per turn than summary+caching — the summary's content
shifts every turn, breaking the cache prefix it would otherwise sit
on. Reconsider only if session lengths empirically blow the context
window.

**Query rewriter for retrieval** (phase 2 in the source design).
Deferred, not rejected. Solves the follow-up retrieval gap. Phase 1
alone resolves the "it is unstated" failure observed in production.
Add when retrieval quality on follow-ups becomes the bottleneck and
not before.

---

## 4 Code changes

### 4.1 New: `src/lib/history.ts`

```ts
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export async function loadSessionHistory(
  sessionId: string,
  opts?: { maxTurns?: number; maxTokens?: number },
): Promise<ChatMessage[]>
```

- Reads `query_text`, `response_text` from `queries` ordered by
  `created_at ASC`. Existing index `(session_id, created_at)` covers
  the read.
- Skips rows where `response_text` is empty (errored streams).
  Replaying a partial response confuses the model.
- Prunes from the front (drop oldest) when either cap is exceeded.
- Defaults: `maxTurns = 6`, `maxTokens = 4000`.

### 4.2 `src/lib/model.ts`

- `completeStream(messages, modelId)` signature change. Drops the
  `SYSTEM_PROMPT` import; the caller assembles the messages array.
- Delete `complete()`. It is currently marked "internal/testing
  use" and has no production callers. Threading the new shape
  through dead code adds churn without exercise.
- Introduce `ChatMessage` from `src/lib/history.ts` and use it as
  the messages parameter type.

### 4.3 `src/lib/budget.ts`

- `makeBudget(tier, reservedExtra?: number)` accepts an extra token
  reservation on top of `SYSTEM_RESERVE`. Caller passes computed
  history token count.

### 4.4 `src/lib/prompt.ts`

- `buildPrompt(queryText, chunks, prefs, tier, reservedExtra?)` —
  forwards `reservedExtra` to `makeBudget`.

### 4.5 `src/app/api/query/route.ts`

After the ownership check (~line 90), before retrieval:

```ts
const history = sessionId
  ? await loadSessionHistory(sessionId, { maxTurns: 6, maxTokens: 4000 })
  : [];
const historyChars  = history.reduce((n, m) => n + m.content.length, 0);
const historyTokens = Math.ceil(historyChars / 4);
```

Pass `historyTokens` as `reservedExtra` to `buildPrompt`.

Update the reservation estimate at line 131:

```ts
const estimatedInputTokens = Math.ceil(
  (SYSTEM_PROMPT.length + historyChars + prompt.length) / 4
);
```

Build the messages array and pass to `completeStream`:

```ts
const messages: ChatMessage[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...history,
  { role: 'user',   content: prompt },
];
const stream = await completeStream(messages, modelId);
```

---

## 5 Schema

No migration. The `queries` table already has the columns and index
required.

A future `retrieval_query TEXT` column (for phase 2 observability)
is *not* added in this PR. It belongs to the phase 2 work.

---

## 6 Prompt caching — what we get for free

Phase 1 produces a stable, growing prefix per session: system prompt
+ prior turns. Providers with automatic prefix caching (deepseek,
OpenAI) will report non-zero `cached_input_tokens` once the prefix
exceeds their threshold (~1024 tokens). The route already reads and
persists `cached_input_tokens` from the usage chunk
(`src/app/api/query/route.ts:208`), so the signal is observable
immediately in the admin session view — no telemetry work required.

Anthropic via OpenRouter requires explicit `cache_control` markers,
which the OpenAI SDK type does not include. Skipping for phase 1.
Add when admin telemetry shows poor cache-hit rates on
Anthropic-using pro users.

---

## 7 Done when

- `loadSessionHistory` returns prior user/assistant pairs in
  chronological order, prunes correctly under both caps, skips rows
  with empty `response_text`.
- `completeStream` accepts a messages array; `complete()` is
  deleted.
- `/api/query` produces a multi-turn `messages` array when a
  sessionId is provided; behaves identically to today on the
  auto-create path (no sessionId → empty history → identical
  request shape).
- `tsc --noEmit` clean.
- Manual verification: replay the production exchange (`c9968a13`).
  Turn 2's response no longer opens with "the antecedent is
  unstated." Model correctly resolves "it" against the prior
  Christianity comparison.
- Token budget reservation accounts for history; spend caps stay
  accurate on multi-turn sessions.
- `cached_input_tokens` shows non-zero values on turn 2+ for
  deepseek/OpenAI users in the admin session view.

---

## 8 Deferred (out of scope for this PR)

- **Query rewriting for retrieval** (phase 2 in the source design).
  Address when follow-up retrieval quality becomes the bottleneck.
- **Long-session pruning beyond FIFO** (sliding window with
  sentinel, running summary). Address when session lengths
  empirically blow the context window. Current FIFO cap (6 turns /
  4k history tokens) plus the existing `MAX_QUERY_CHARS = 4000` on
  new turns is comfortably under all curated models' context
  windows.
- **Anthropic `cache_control` markers.** Add when admin telemetry
  shows Anthropic-using pro users producing poor cache-hit ratios.
- **Mode-switch mid-session.** The pending modes BRD proposes
  forking to a new session for prompt changes; that decision stands
  and is unaffected by this work.

---

## 9 Risks

- **Replay token-cost growth.** Without caching, cost per turn grows
  linearly with session length. With caching (automatic on
  deepseek/OpenAI), the new turn pays full price; the cached prefix
  pays the cached rate. FIFO pruning at 6 turns / 4k tokens caps the
  worst case independent of caching.
- **Errored prior turns.** Replaying half a response confuses the
  model. Mitigated by skipping rows with empty `response_text` in
  `loadSessionHistory`. Truncated-but-non-empty responses (network
  abort mid-stream) *will* be replayed — acceptable, since the user
  saw that truncated content and a follow-up referring to it should
  see the same.
- **Cache prefix instability across model swaps.** A pro user
  changing their preferred model mid-session shifts the request
  shape; some providers will treat the new request as a cold start.
  Acceptable. Model swap is a deliberate user action.

---

## 10 Open questions

1. Strip the `CITATIONS:` block from replayed assistant responses
   to save tokens? Lean: no. The model uses prior citations as
   context for follow-ups; stripping breaks that link. Reconsider
   only if pruning becomes aggressive enough to need every saved
   token.
2. Per-tier history caps (pro gets 10 turns, free gets 4)? Lean:
   not in v1. Same cap for both keeps the code simple. The
   difference between tiers stays in the model picker, not in
   conversational depth.
