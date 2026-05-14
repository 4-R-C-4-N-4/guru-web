# Implementation Plan — Chat Voice + Engagement Hook

Companion to `BRD-chat-voice.md` and `CORE_RULES-draft.md`. The BRD
answers *what* and *why*; this doc answers *which PRs, in what order,
with what scope*.

Each section below corresponds to one ticket. The phasing reflects a
deliberate split: the **engagement fix** (followup-hook rule in
CORE_RULES) can ship as a tiny standalone PR — and probably *should*,
since user feedback identifies disengagement as the more critical
problem than voice. The **voice picker** is then a layered addition on
top of that foundation.

**Hard rule:** ticket 1 (CORE_RULES live) is the engagement fix and
ships first. It's a self-contained value drop and does not depend on
any of the picker tickets. Don't let the picker work block it.

**Hard rule 2:** ticket 8 (eval gate) gates ticket 7 (UI exposes the
picker). A pro user must not be able to select a voice that hasn't
been verified to preserve citation behavior. The voice can exist in
code (ticket 3) without being user-selectable (ticket 7) — that's the
intended landing pattern.

---

## Parent ticket

```
feat: chat voice picker + engagement hook
type:  feature
tags:  chat, prompt, pro, ux, engagement
file:  docs/chat-voice/BRD-chat-voice.md
```

Implements the voice picker described in `BRD-chat-voice.md` and the
followup-hook rule authored in `CORE_RULES-draft.md`. Phase 1 (tickets
1–2) ships the engagement fix on the current voice. Phase 2 (tickets
3–8) lands the picker, the woowoo voice, the data layer, and
the eval gate.

**Prereq:** the CORE_RULES draft in `CORE_RULES-draft.md` must be
read, iterated, and accepted by the operator before ticket 1 starts.
Ticket 1 ships the *approved* text, not the current draft.

Closes when all children close.

---

## 1. Ship CORE_RULES on current scholar voice (engagement fix)

```
type:  feature
tags:  prompt, engagement, chat
file:  src/lib/prompt.ts
```

**Scope.** The single smallest change that delivers the engagement
fix. Replace the existing `SYSTEM_PROMPT` constant
(`src/lib/prompt.ts:17`) with the current scholar identity opening
(unchanged in spirit) concatenated with the approved CORE_RULES text
from `CORE_RULES-draft.md`. No architecture refactor, no schema, no
UI. The new followup-hook rule (CORE_RULES §6) is what does the work.

**Files:**

- `src/lib/prompt.ts` — rewrite `SYSTEM_PROMPT` as
  `[current identity opening prose] + [approved CORE_RULES text]`.
  Keep the export name and shape (`export const SYSTEM_PROMPT`) so
  the route at `src/app/api/query/route.ts:146` and `:183` keep
  working without changes.
- `src/__tests__/prompt.test.ts` (new or extend) — snapshot test on
  `SYSTEM_PROMPT` so accidental drift is caught in review.

**Done when:**

- A query to `/api/query` produces a response that ends with a
  specific thread-opener rooted in the reply (per CORE_RULES §6) —
  not a generic "let me know if you have more questions."
- The closing beat lands immediately before the `CITATIONS:` block.
- The citation block format is unchanged.
- `npx tsc --noEmit` clean.
- `npm run lint` clean.
- Existing query route tests still pass.

**Tests:**

- Snapshot the prompt string in unit tests so any future change is a
  deliberate diff.
- Smoke (manual, post-deploy): ask 3 representative queries (a
  cross-tradition synthesis, a definitional question, a tight yes/no
  question) and confirm each reply ends with a hook *or* the
  escape-hatch omission feels justified.

**Operator action post-merge.** None.

**Blocks:** nothing in this doc. This ticket is independently
shippable and addresses the most critical feedback we have.

**Depends on:** CORE_RULES draft acceptance (see parent ticket
prereq).

---

## 2. Refactor prompt.ts to layered architecture

```
type:  chore
tags:  prompt, refactor, architecture
file:  src/lib/prompt.ts
```

**Scope.** Split the now-shipped SYSTEM_PROMPT (from ticket 1) into
the layered structure described in BRD §3:

```ts
type VoiceSlug = 'scholar';   // expand in ticket 3
const DEFAULT_VOICE: VoiceSlug = 'scholar';
const CORE_RULES = `…approved text from CORE_RULES-draft.md…`;
const VOICE_OVERLAY: Record<VoiceSlug, string> = {
  scholar: `…current identity opening…`,
};
export function getSystemPrompt(voice: VoiceSlug): string { … }
export function isVoiceSlug(v: string): v is VoiceSlug { … }
```

After this ticket, `SYSTEM_PROMPT` is gone; consumers call
`getSystemPrompt(voice)`.

**Files:**

- `src/lib/prompt.ts` — add the new exports, remove `SYSTEM_PROMPT`.
- `src/app/api/query/route.ts` — replace `SYSTEM_PROMPT` references
  at `:146` (token estimation) and `:183` (messages array) with
  `getSystemPrompt('scholar')` for now. Voice resolution from data
  lands in ticket 5.
- `src/__tests__/prompt.test.ts` — extend snapshot test to cover
  the composed output, plus a test that `getSystemPrompt('scholar')`
  matches the ticket-1 shipped string exactly (no behavior change
  in this refactor).

**Done when:**

- `getSystemPrompt('scholar')` returns the same string ticket 1
  ships (verified by test).
- TypeScript treats unknown voice slugs as compile errors.
- `npx tsc --noEmit` clean; full test suite green.
- Manual smoke: one query produces the same prompt as before
  (snapshot test is sufficient automated proof).

**Tests:** unit only. The refactor must be behavior-preserving.

**Operator action post-merge.** None.

**Depends on:** ticket 1 (the approved CORE_RULES text is the input
to the new structure).

---

## 3. Author + register woowoo voice overlay

```
type:  feature
tags:  prompt, voice, copy
file:  src/lib/prompt.ts
```

**Scope.** Add a second voice to `VOICE_OVERLAY` — the woowoo
register from the conversation that produced the BRD. The voice
exists in code but is **not yet user-selectable** (no schema, no API,
no UI). This lets us pair it with CORE_RULES end-to-end and feed it
to the eval gate (ticket 8) before exposing it to users.

The overlay text is its own authoring task. The draft starting point
is the prompt the operator drafted earlier in conversation ("You are
Guru, a scholar of cross-tradition esoteric thought who is alive to
the material…"), with the rules section *stripped* — those now live
in CORE_RULES. The overlay is just identity + engagement-mode
framing.

**Files:**

- `docs/chat-voice/VOICE-woowoo-draft.md` (new) — companion
  draft for the woowoo overlay text, mirroring
  `CORE_RULES-draft.md`. Source of truth for the wording before it
  lands in code.
- `src/lib/prompt.ts` — extend `VoiceSlug` union with the new slug
  (suggest `'woowoo'` — short, unambiguous, doesn't collide with
  "scholar"), extend `VOICE_OVERLAY` with the approved text.
- `src/__tests__/prompt.test.ts` — snapshot the composed prompt for
  the new voice; assert citation block and followup-hook rule are
  present in the output.

**Done when:**

- Draft file exists and operator has approved the wording.
- `getSystemPrompt('woowoo')` returns the composed prompt.
- Snapshot test pins the wording.
- No user-facing behavior change (the voice is not selectable yet).

**Tests:** unit + snapshot.

**Operator action post-merge.** None.

**Depends on:** ticket 2. Independent of tickets 4–7.

---

## 4. Schema — preferred_voice + session voice snapshot

```
type:  chore
tags:  schema, migration, voice
file:  migrations/012_chat_voice.sql
```

**Scope.** Add the two columns from BRD §7.1.

**Files:**

- `migrations/012_chat_voice.sql` (new):
  ```sql
  ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS preferred_voice TEXT NOT NULL DEFAULT 'scholar';
  ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS voice TEXT NOT NULL DEFAULT 'scholar';
  ```
  No CHECK constraint; values are validated in app code (same
  pattern as `preferred_model`).
- `src/lib/types.ts` — add `preferredVoice: VoiceSlug` to
  `UserPreferences`.
- `src/lib/prefs.ts` — extend `loadPrefs` SELECT list and return
  shape to include `preferred_voice`.

**Done when:**

- `deploy.sh`'s `psql -1 -v ON_ERROR_STOP=1` applies migration 012
  cleanly; re-running is the idempotency test (`IF NOT EXISTS`).
- `loadPrefs(userId)` returns a `preferredVoice` field equal to
  `'scholar'` for all existing users (default).
- New sessions inserted before ticket 5 ships still get `'scholar'`
  via the column default.

**Tests:** unit on `loadPrefs` shape; no DB integration test needed
(migration is idempotent and verified post-deploy via
`\d user_preferences` and `\d sessions`).

**Operator action post-merge.** Migration auto-applies on next
deploy.

**Depends on:** ticket 2 (`VoiceSlug` type must exist before
`UserPreferences` references it).

---

## 5. Query route — voice snapshot at session creation, resolution at query

```
type:  feature
tags:  api, voice, integration
file:  src/app/api/query/route.ts
```

**Scope.** Wire ticket 4's columns + ticket 3's overlays into the
live query path. BRD §7.3.

Two distinct touch points:

1. **Session creation.** At the point where a new `sessions` row is
   inserted (grep `INSERT INTO sessions` in
   `src/app/api/query/route.ts` or wherever this lives), snapshot
   `voice = (tier === 'pro' && isVoiceSlug(prefs.preferredVoice))
   ? prefs.preferredVoice : 'scholar'`. Free users always snapshot
   to `'scholar'` regardless of their stored preference.
2. **Query execution.** Replace `getSystemPrompt('scholar')` calls
   (added in ticket 2) with `getSystemPrompt(session.voice)`. The
   session row is already loaded for context; just read the column.

**Files:**

- `src/app/api/query/route.ts` — both touch points above. Token
  estimation at `:146` uses the resolved system prompt's length.
- `src/__tests__/api.test.ts` (extend) — pro user with
  `preferredVoice = 'woowoo'` triggers `getSystemPrompt('woowoo')` on
  the *first* query of a new session, and on every subsequent query
  in that session; free user with same preference still gets
  `'scholar'`; pro user who downgrades after creating an `'woowoo'`
  session still gets `'woowoo'` on follow-up queries in that
  session.

**Done when:**

- Snapshot behavior verified by test.
- Free user's `sessions.voice` is always `'scholar'`.
- Pro user's session inherits their profile default at creation.
- Changing profile voice does not change any existing session's
  voice (the snapshot is immutable for the life of the session).
- `npx tsc --noEmit` clean; tests pass.

**Tests:**

- Unit: route handler with mocked auth/prefs/DB — assert correct
  voice flows through.
- Manual smoke post-deploy: as a pro user, flip
  `preferred_voice = 'woowoo'` via SQL on the VPS, start a new
  session, verify `sessions.voice` is `'woowoo'`. Then flip back to
  `'scholar'`, send another query in the *same* session, confirm
  the reply is still woowoo-toned (session snapshot wins). Start a
  fresh session, confirm it's scholar (new session reads current
  pref).

**Operator action post-merge.** None.

**Depends on:** tickets 2, 3, 4.

---

## 6. Preferences API — preferredVoice round-trip

```
type:  feature
tags:  api, settings, voice, pro
file:  src/app/api/preferences/route.ts
```

**Scope.** Extend the existing preferences endpoint. BRD §7.4.

**Files:**

- `src/app/api/preferences/route.ts`:
  - GET response includes `preferredVoice`.
  - PUT body validation accepts `preferredVoice`, validates via
    `isVoiceSlug`, rejects unknown slugs with 400.
  - **Server-side pro gate:** non-pro users sending
    `preferredVoice !== 'scholar'` are rejected with 403. This must
    be enforced server-side; UI gate alone is not sufficient.
- `src/__tests__/preferences.test.ts` (extend or new) — round-trip
  voice write/read; invalid slug 400; non-pro setting non-default
  403.

**Done when:**

- Pro user can PUT `{ preferredVoice: 'woowoo' }` and GET returns
  the same value.
- Non-pro user PUTting the same is rejected with 403.
- Any user PUTting `{ preferredVoice: 'gibberish' }` is rejected
  with 400.
- `npm run build` and `npm run lint` clean.

**Tests:** unit (API handler with mocked auth + DB).

**Operator action post-merge.** None.

**Depends on:** tickets 2, 4.

---

## 7. Settings UI — voice picker

```
type:  feature
tags:  ui, settings, voice, pro
file:  src/app/(app)/settings/page.tsx
```

**Scope.** New "Voice" section on the settings page, mirroring the
existing model picker pattern. BRD §7.6.

**Files:**

- `src/app/(app)/settings/page.tsx` — new "Voice" section. Native
  HTML radio buttons (one per shipped voice). Each row renders:
  - Voice name (e.g., "Scholar", "Woowoo").
  - One-line description so the user sees *what* they're picking,
    not just a slug. Descriptions live in a small const in the
    settings page (the user-facing copy is UI-layer, not
    prompt-layer).
  - Currently-selected option highlighted (default `'scholar'` if
    unset).
- Free users see the section disabled with a "Pro only" tag (same
  pattern as the model picker — see model-selection ticket 5 for
  the visual reference).
- PUT to `/api/preferences` on change.
- `src/__tests__/settings.test.ts` (extend) — round-trip with
  mocked fetch; free user sees disabled state; invalid pick can't
  be sent (radio constrains to known values).

**Done when:**

- Pro user's settings page shows the voice options, current
  selection highlighted.
- Selecting a different option PATCHes and persists; reload shows
  it persisted.
- Free user sees the section disabled with the Pro tag and an
  upgrade link.
- `npm run build` and `npm run lint` clean.

**Tests:**

- Component round-trip with mocked fetch.
- Smoke: pick each shipped voice, start a new session, verify the
  response tone matches.

**Operator action post-merge.** None.

**Depends on:** tickets 3, 6. **Blocked by ticket 8** — do not
expose a voice in the picker until it has passed the eval gate.

---

## 8. Eval gate — adversarial citation behavior

```
type:  chore
tags:  eval, citations, voice, qa
file:  scripts/eval-voices.ts
```

**Scope.** The eval gate from BRD §8.4. The risk: a more lyrical
voice (woowoo) sits in the exact register where models start
inventing supporting quotes. CORE_RULES is meant to hold the line,
but we need empirical proof before exposing the voice in the picker.

**Files:**

- `scripts/eval-voices.ts` (new) — small script that:
  - Loads a fixture of N (suggest N=15) adversarial query/passages
    pairs where the retrieved passages **don't** support the
    obvious answer.
  - Runs each query under each shipped voice via the same prompt
    assembly the production route uses.
  - Scores each response on three axes: (1) any quoted material
    attributed to a non-retrieved text? (2) any tradition-content
    claim ungrounded in the passages? (3) was a register-shift
    phrase used when going beyond the passages?
  - Outputs a pass/fail summary per voice.
- `docs/chat-voice/EVAL-fixtures.md` (new) — the fixture set in
  readable form (the queries + expected register-shift phrasing).
  Source of truth; the eval script reads from it (or from a JSON
  sibling).
- Run output committed as a one-time note for the launch (e.g., a
  short section appended to `BRD-chat-voice.md` §8 or a separate
  EVAL-results.md).

**Done when:**

- Eval script runs locally against OpenRouter (or a mocked LLM if
  cost is a concern for CI — but the real LLM is the actual
  check).
- All shipped voices pass: 0 fabricated quotes, 0 ungrounded
  tradition-content claims, register shifts signaled on
  beyond-passages claims.
- A failing voice blocks ticket 7 from exposing it.

**Tests:** the eval IS the test. No unit-test surface.

**Operator action post-merge.** Run the eval script once before
ticket 7 ships; re-run any time `CORE_RULES` or a voice overlay
changes.

**Depends on:** tickets 2, 3. Can run in parallel with tickets 4–6.

---

## Cross-cutting commitments

These apply to every ticket; called out once here so they don't get
lost.

- **CORE_RULES is the contract.** No voice overlay may relax
  grounding, no-invention, register signaling, precision, format,
  followup-hook, or citation rules. If a voice needs different
  behavior on one of those axes, that's a CORE_RULES change, not a
  voice override.
- **Server-side pro gate.** UI gate is necessary but not
  sufficient. Every preference write that includes a non-default
  voice must be validated server-side (ticket 6).
- **Snapshot tests on prompt strings.** Any change to CORE_RULES or
  a voice overlay is a deliberate diff visible in PR review. No
  silent prompt drift.
- **Slug in user_preferences, slug in sessions, slug in prefs
  loader return.** Never resolve to the composed prompt string and
  store it; the composition happens at request time so prompt
  changes apply retroactively to all sessions of the same voice.
- **Tokens-only styling** for the picker, matching the model
  picker.

---

## Out-of-band / deferred

Listed for visibility, not in scope for this feature:

- **Chat-header voice indicator / quick switcher.** BRD §7.7. Data
  is on the session row; UI affordance is future work.
- **Per-session voice override at creation.** Currently a user must
  change their profile default to start a new session in a
  different voice. If usage shows demand, add a per-session picker.
- **Additional voices.** Each new overlay is a PR adding a slug + a
  text + a snapshot test + a pass through the eval gate (ticket 8).
  Plausible candidates listed in BRD §4.3 (terse, socratic).
- **Mid-thread voice swap.** Forks to a new session rather than
  mutating `sessions.voice`. Same coherence argument as the
  snapshot rule.
- **Per-message voice swap.** Explicit non-goal (BRD §5.4).
- **Voice analytics.** Telemetry on which voice gets picked and
  whether voice correlates with retention is a post-launch chore,
  separate doc when the data is ready to read.
