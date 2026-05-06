# Implementation Plan — Multi-Turn Conversation Continuity (Phase 1)

Companion to `BRD-conversation-continuity.md`. The BRD answers
*what* and *why*; this doc answers *which tickets, in what order,
with what scope*.

Convert each section below to a `todo` once the parent feature
ticket exists. All five tickets land in a single PR — phase 1 is
small enough (~150 line diff) that splitting introduces churn
without buying review clarity.

**Hard rule 1:** ticket 3 (`completeStream` signature change) is a
breaking API edit. The route at `src/app/api/query/route.ts:164`
and the mock at `src/__tests__/api.test.ts:60` are the only callers
— both must update in the same diff. Skipping ahead means the build
breaks.

**Hard rule 2:** ticket 1 (`loadSessionHistory`) lands before
ticket 4 (route wiring). The helper is consumed in step 4.

**Hard rule 3:** make the new `makeBudget` and `buildPrompt`
parameters *optional* (default 0). The existing test suites at
`src/__tests__/budget.test.ts` and `src/__tests__/prompt.test.ts`
call these with the old arity — keeping the new param optional
means those tests stay green without churn.

---

## Parent ticket

```
feat: multi-turn conversation continuity (phase 1)
type:  feature
tags:  api, model, budget, sessions, ux
file:  docs/conversation-continuity/BRD-conversation-continuity.md
```

Implements BRD §1 phase 1. Phases 2 (rewriter) and 3 (Anthropic
cache markers) and pruning beyond FIFO are deferred per BRD §8.
Closes when all child tickets close and the manual verification
against session `c9968a13` passes (BRD §7).

---

## 1. `loadSessionHistory` helper

```
type:  chore
tags:  sessions, db, history
file:  src/lib/history.ts
```

**Scope.** Pure read-side helper. Pulls prior turns from the
existing `queries` table, prunes to FIFO caps, and hands back a
flat `ChatMessage[]` ready to splice into the model request. No
schema change, no other module touched.

**Files:**

- `src/lib/history.ts` (new):
  - Export `type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }`.
  - Export `async function loadSessionHistory(sessionId: string, opts?: { maxTurns?: number; maxTokens?: number }): Promise<ChatMessage[]>`.
  - Defaults: `maxTurns = 6`, `maxTokens = 4000`.
  - SQL: `SELECT query_text, response_text FROM queries WHERE session_id = $1 ORDER BY created_at ASC` — covered by the existing `idx_queries_session` (`migrations/002_sessions_queries.sql:27`).
  - Use `query<{ query_text: string; response_text: string }>` from `src/lib/db.ts:17`.
  - Skip rows with empty `response_text` (errored streams). Filter, do not throw.
  - Flatten each row into two messages: `{ role: 'user', content: query_text }`, `{ role: 'assistant', content: response_text }`.
  - Apply pruning: trim from the front (oldest) until both `messages.length <= maxTurns` AND total content length `<= maxTokens * 4`. Always trim user/assistant *pairs*, never split a pair (don't leave an orphan assistant message at the front).
- `src/__tests__/history.test.ts` (new):
  - Empty session → `[]`.
  - Two-turn session → 4 messages in chronological order, alternating user/assistant.
  - Row with empty `response_text` → that pair is skipped.
  - Pruning by turns: 8 prior turns + `maxTurns = 6` → returns the last 6 turns (3 pairs), oldest 2 dropped.
  - Pruning by tokens: pairs that exceed `maxTokens` budget are dropped from the front.
  - Pair-atomic pruning: when a single pair would push over the cap, drop the whole pair (no orphan assistant at index 0).

**Done when:**

- `npx tsc --noEmit` clean.
- `npx vitest run src/__tests__/history.test.ts` clean.
- Manual: in a `psql` session, pick a real `sessionId` with ≥2 queries, call `loadSessionHistory(id)` from a node REPL → returns the expected message array.

**Tests:** unit only. The DB shape is well-known and the function is pure SQL + array logic.

**Operator action post-merge.** None.

**Depends on:** nothing. Can land first.

**Blocks:** ticket 4.

---

## 2. `makeBudget` and `buildPrompt` accept extra reserve

```
type:  chore
tags:  budget, prompt, history
file:  src/lib/budget.ts
```

**Scope.** Plumb a `reservedExtra` token count through the budget
and prompt-builder so the route can subtract history tokens from
the chunks budget. Backwards-compatible: optional param defaults to
0, all existing callers keep working unchanged.

**Files:**

- `src/lib/budget.ts:82` — extend `makeBudget`:
  ```ts
  export function makeBudget(tier: 'free' | 'pro', reservedExtra = 0): TokenBudget {
    return new TokenBudget(
      CONTEXT_WINDOWS[tier],
      SYSTEM_RESERVE + reservedExtra,
      RESPONSE_RESERVE,
    );
  }
  ```
  Note: fold `reservedExtra` into `systemReserve` rather than adding a 4th constructor arg — keeps `TokenBudget` itself unchanged.
- `src/lib/prompt.ts:69` — extend `buildPrompt` with optional 5th param `reservedExtra: number = 0`, forwarded to `makeBudget(tier, reservedExtra)`.
- `src/__tests__/budget.test.ts` (extend) — one new test: `makeBudget('pro', 1000)` reduces `available` by exactly 1000 tokens versus `makeBudget('pro')`.
- `src/__tests__/prompt.test.ts` (extend) — one new test: passing a `reservedExtra` large enough to push over the budget causes `buildPrompt` to emit fewer chunks than the same call without the extra reserve.

**Done when:**

- `npx tsc --noEmit` clean.
- `npx vitest run src/__tests__/budget.test.ts src/__tests__/prompt.test.ts` clean.
- All existing tests still pass without modification (backwards-compatible default).

**Tests:** unit only. Pure functions.

**Operator action post-merge.** None.

**Depends on:** nothing.

**Blocks:** ticket 4.

---

## 3. `completeStream` accepts messages array; delete `complete()`

```
type:  chore
tags:  model, breaking-change
file:  src/lib/model.ts
```

**Scope.** The signature change. Replaces the single-prompt shape
with an explicit `messages` array so the caller controls prior-turn
splicing. Drops the unused `complete()` to avoid threading the new
shape through dead code.

**Files:**

- `src/lib/model.ts`:
  - Drop the `import { SYSTEM_PROMPT } from './prompt'` at line 12. The system prompt is now assembled by the caller.
  - Delete `complete()` (lines 71–82). Confirm no production callers via `grep -rn '\bcomplete\b' src --include='*.ts' --include='*.tsx' | grep -v completeStream` — the only matches today are unrelated comments.
  - Replace `completeStream(prompt: string, modelId: string)` (line 88) with:
    ```ts
    import type { ChatMessage } from './history';

    export async function completeStream(
      messages: ChatMessage[],
      modelId: string,
    ) {
      return client().chat.completions.create({
        model: modelId,
        messages,
        temperature: 0.3,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
      });
    }
    ```
  - Update the file's docstring at line 7 to drop the `complete()` reference.
- `src/__tests__/api.test.ts:60` — the mock signature for `completeStream` widens to accept the messages array. Re-check assertions that inspect the call arguments (currently any test that does `expect(mockStream).toHaveBeenCalledWith(prompt, modelId)` needs `expect(mockStream).toHaveBeenCalledWith(messages, modelId)` with `messages` matching the new shape).

**Done when:**

- `npx tsc --noEmit` clean.
- `npx vitest run src/__tests__/api.test.ts` clean. Existing assertions on `completeStream` arguments updated to the new shape.
- `complete` is gone from `src/lib/model.ts`. `grep -rn '\bcomplete\b' src --include='*.ts'` returns only unrelated matches.

**Tests:** unit only. The route-integration test in ticket 4 is what exercises the wiring end-to-end.

**Operator action post-merge.** None — the change is API-shape-only at the OpenRouter boundary; the wire format to OpenRouter is identical (still a `messages` array with the same role keys).

**Depends on:** ticket 1 (uses `ChatMessage` type from history.ts).

**Blocks:** ticket 4.

---

## 4. `/api/query` threads history into messages array

```
type:  chore
tags:  api, sessions, history, integration
file:  src/app/api/query/route.ts
```

**Scope.** The integration step. Loads prior turns, computes the
history token reservation, builds the messages array, updates the
spend reservation estimate to account for history tokens.

**Files:**

- `src/app/api/query/route.ts`:
  - Import additions:
    ```ts
    import { loadSessionHistory } from '@/lib/history';
    import type { ChatMessage } from '@/lib/history';
    ```
  - After the ownership check (currently line 90), before retrieval at line 95, add:
    ```ts
    // Load prior turns for the messages array. Empty when no sessionId
    // (auto-create path) — first turn has no history by definition.
    const history = sessionId
      ? await loadSessionHistory(sessionId, { maxTurns: 6, maxTokens: 4000 })
      : [];
    const historyChars  = history.reduce((n, m) => n + m.content.length, 0);
    const historyTokens = Math.ceil(historyChars / 4);
    ```
  - Update `buildPrompt` call at line 96 to pass `historyTokens` as the 5th arg.
  - Update the reservation estimate at line 131:
    ```ts
    const estimatedInputTokens = Math.ceil(
      (SYSTEM_PROMPT.length + historyChars + prompt.length) / 4
    );
    ```
  - Replace the `completeStream(prompt, modelId)` call at line 164 with:
    ```ts
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user',   content: prompt },
    ];
    const stream = await completeStream(messages, modelId);
    ```
- `src/__tests__/api.test.ts` (extend):
  - Mock `loadSessionHistory` (or seed test DB with prior queries — match the existing test style in this file).
  - Test: query into a session with one prior turn → `completeStream` called with a 3-message array (system + prior user + prior assistant + new user = 4 messages; verify roles in order).
  - Test: query with no `sessionId` → `completeStream` called with a 2-message array (system + new user); behaviour identical to today.
  - Test: spend reservation grows when history is present — assert the `estimatedCostUsd` passed to `reserveBudget` is larger when a session has prior turns vs. when it doesn't.
  - Test: empty `response_text` rows are skipped — pair with one good prior turn + one errored prior turn → only the good pair appears in the messages array.

**Done when:**

- `npx tsc --noEmit` clean.
- `npx vitest run src/__tests__/api.test.ts` clean.
- Full suite: `npx vitest run` clean.
- Manual end-to-end (BRD §7): replay session `c9968a13`'s exchange against staging. Turn 2's response no longer opens with "the antecedent is unstated"; model resolves "it" against the prior Christianity comparison.
- Token reservation visibly accounts for history: in admin session view, `input_tokens` for turn 2 is materially larger than turn 1 (reverses the production bug where turn 2 was *smaller*).
- For deepseek/OpenAI users: `cached_input_tokens` becomes non-zero on turn 2+ — verify in admin session view.

**Tests:** unit (mocked DB) for the integration shape; manual smoke for the actual fix.

**Operator action post-merge.** None. New sessions immediately benefit; existing in-progress sessions also benefit on their next turn (the read is purely a fetch from existing rows).

**Depends on:** tickets 1, 2, 3.

**Blocks:** nothing. This is the final ticket.

---

## 5. Manual verification (no code; gating step)

```
type:  chore
tags:  verification, manual-test
file:  docs/conversation-continuity/BRD-conversation-continuity.md
```

**Scope.** Reproduce the BRD's source incident and confirm the fix.
This is the gate before closing the parent ticket.

**Procedure:**

1. On staging or local, log in as a test pro user.
2. Issue query 1: *"Talk to me about Neoplatonism, is this tradition similar to Christianity?"*. Note the new `sessionId` from the response (`X-Session-Id` header or the auto-created session row).
3. Issue query 2 against the same session: *"So it is more similar to Gnosticism."*
4. Open `/admin/sessions/{sessionId}` and inspect both queries.

**Expected:**

- Turn 2's `input_tokens` is **larger** than turn 1's, not smaller. (In production it was 2,741 vs 8,389 — reversed.)
- Turn 2's response does **not** open with phrasing like "the antecedent is unstated" or "you have posed a compact query." It engages the comparison directly.
- For deepseek/OpenAI models: turn 2's `cached_input_tokens` is non-zero. (Anthropic users will still show 0 — see BRD §6, deferred to phase 3.)

**Done when:** all three expectations hold on a fresh staging session.

**Operator action post-merge.** None.

**Depends on:** ticket 4.

---

## Phasing summary

All five tickets ship together as a single PR. Suggested commit
breakdown within the PR (for reviewer hygiene, not for staged
deploy):

1. `feat(history): loadSessionHistory helper`
2. `chore(budget): reservedExtra plumbing in makeBudget + buildPrompt`
3. `refactor(model): completeStream takes messages array; drop complete()`
4. `feat(api/query): thread session history into messages array`
5. (no commit; ticket 5 is verification only)

Single PR, four commits, parent ticket closes on manual verification.
