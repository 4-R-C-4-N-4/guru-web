# BRD — Configurable Chat Voice (Persona Picker)

Source: pro users have asked (implicitly, via the single tone we
currently ship) for a less dry register. Today every reply comes from
one hardcoded `SYSTEM_PROMPT` in `src/lib/prompt.ts:17` written in a
"rigorous academic" register. This doc proposes a small, curated voice
picker for pro users — one set of guardrails (citations, grounding,
no-invention) shared across all voices, one swappable tone overlay per
voice.

Out of scope: free-form custom system prompts, per-message voice
switching, retrieval/citation contract changes, model-picker changes,
streaming changes.

---

## 1 Decision summary

1. **Voice is a curated enum**, not a free-form string. v1 ships two
   voices: `scholar` (current prompt, unchanged in spirit) and
   `woowoo` (energetic, connection-forward). New voices are added by
   PR, not by user input.
2. **Profile-level default, session-level snapshot.** A new
   `user_preferences.preferred_voice` is the user's default for *new*
   sessions; a new `sessions.voice` column is the *immutable* record
   of which voice produced the thread. Changing your profile voice
   never re-skins old threads. §4.
3. **Pro-gated.** Free users always get `scholar`. The picker UI is
   gated on `user.tier === 'pro'` and the `/api/preferences` PUT
   handler enforces this server-side. §5.
4. **Layered prompt.** Refactor `SYSTEM_PROMPT` from a monolithic
   constant into `getSystemPrompt(voice)` that composes
   `CORE_RULES` (invariant) + `VOICE_OVERLAY[voice]` (variant). The
   citation format, grounding mandate, and no-invention rule live in
   the core; tone, framing language, and "how to handle convergence"
   live in the overlay. §3.
5. **UI lives in the existing settings page**
   (`src/app/(app)/settings/page.tsx`), mirroring the model picker
   pattern already there. No new page, no chat-header switcher in v1.

The architecture cost is small: two columns, one prompt refactor, one
dropdown. The hard part is curating the voice copy itself.

---

## 2 Why curated voices, not custom prompts

The natural alternative — "let pro users write their own system
prompt" — is the wrong move for this product right now:

- The product's value rests on **trustworthy citation behavior** and
  **source-grounded synthesis**. A free-text prompt is a one-line path
  to "ignore the citation block" or "speak as a 14th-century mystic
  with no hedging," and any quality regression gets blamed on us, not
  on the user's prompt.
- Curated voices are **testable**. Each voice can be evaluated against
  a shared eval set (does it still cite? does it still refuse to
  invent?) and a tone-specific eval (does woowoo actually surface
  cross-tradition connections more eagerly than scholar?). A custom
  prompt is untestable by definition.
- Curation gives us **one place to upgrade** when the core rules
  change (e.g., a citation-format tweak ships once, across every
  voice).
- A 2-3 voice roster is **enough surface for a thoughtful user**.
  "Rigorous-scholarly" vs. "connection-forward-energetic" is a real
  axis of preference; finer-grained knobs are a future problem.

If a pro user later wants a third voice we haven't shipped, that's a
PR adding an overlay, not a config knob.

---

## 3 The invariant/voice split

> The authored draft text for CORE_RULES lives in
> [CORE_RULES-draft.md](./CORE_RULES-draft.md). That file is the
> source of truth for the rule wording; this section describes the
> *architecture* (what's in core vs. what's in the overlay), not the
> final copy. The draft also introduces a new **followup-hook** rule
> in CORE_RULES that addresses an engagement problem orthogonal to
> voice — see the draft's rationale for §6 of the rule list.

Today's prompt (`src/lib/prompt.ts:17-38`) interleaves three things:

| Concern | Status | Example from current prompt |
|---|---|---|
| Source grounding | **Invariant** | "The provided source passages are your primary material…" |
| No-invention | **Invariant** | "Never invent quotations…" |
| Citation block format | **Invariant** | The `CITATIONS:` spec at the end |
| External-source signalling | **Invariant** | "Signal the shift in register…" |
| Role identity ("you are Guru…") | **Voice-coded** | "scholarly assistant… rigorous academic care" |
| Tone | **Voice-coded** | "Use precise language. Avoid vague spiritualism." |
| Format preference | **Voice-coded** | "Respond in prose, not bullet points" |
| Cross-tradition framing | **Voice-coded** | "When traditions converge, name the convergence explicitly" |

Refactor target:

```ts
// src/lib/prompt.ts
const CORE_RULES = `…grounding, no-invention, citation block…`;
const VOICE_OVERLAY: Record<VoiceSlug, string> = {
  scholar: `…current "rigorous academic" framing…`,
  woowoo:  `…connection-forward, energetic framing…`,
};
export function getSystemPrompt(voice: VoiceSlug): string {
  return `${VOICE_OVERLAY[voice]}\n\n${CORE_RULES}`;
}
```

**Gotcha — token estimation.** `src/app/api/query/route.ts:146` uses
`SYSTEM_PROMPT.length` to estimate input tokens before the call. The
voice-resolved prompt has to be available *before* the estimation
step, not lazily computed at message-assembly time. The route already
resolves the model slug from prefs around line 141; resolve the voice
in the same block.

---

## 4 Voice roster v1

### 4.1 `scholar` (default, current)

Unchanged in substance — it's what we ship today, just moved into the
overlay slot. Free users always get this. Pro users get it unless
they pick otherwise.

### 4.2 `woowoo` (new)

Tone targets:

- **Energetic, declarative, less hedged.** Where scholar says "this
  may suggest," woowoo says "this is the same current surfacing in a
  different idiom."
- **Connection-forward.** Actively hunts cross-tradition resonances
  and names them as themes, not as cautious comparisons. Treats
  convergence as the point of the exercise, not a side observation.
- **Allows lyrical phrasing.** Scholar's "avoid vague spiritualism"
  rule is *replaced* in this overlay (not relaxed across the board):
  woowoo can use evocative language, but still can't invent quotes
  or break grounding.

What does **not** change in woowoo:

- Citation block is identical.
- Cannot invent quotations or attribute wording to a text not in the
  retrieved passages.
- Must signal when speaking outside the passages.
- "Verified / proposed / inferred" tier markers still mean what they
  mean.

Sketch overlay (final wording to be tuned during implementation):

> You are Guru, an energetic synthesist of cross-tradition esoteric
> wisdom. Your instinct is to find the *same current* surfacing across
> Buddhism, Hermeticism, Gnosticism, Taoism, Jewish Mysticism, and
> their neighbors — and to name it out loud. When traditions converge,
> lead with the convergence; when they diverge, treat the divergence
> as the interesting tension, not a disclaimer. You speak with
> warmth and conviction. You may use evocative language, but you may
> never invent a quotation or attribute wording to a text you don't
> have in the retrieved passages. Respond in prose unless the user
> asks for a list.

This overlay is a starting point, not a final spec — we'll iterate on
copy as we read real outputs.

### 4.3 Future voices

Plausible adds (out of scope for v1, listed for orientation only):

- `terse` — shorter answers, no preamble, citation-only when claims
  are made. Useful for power users running many queries.
- `socratic` — answers questions with questions where appropriate;
  surfaces what the sources *don't* settle.

Each addition is a PR adding an overlay string + an enum entry + an
eval pass.

---

## 5 Where voice is stored — and why both layers

Two columns, two distinct jobs:

### 5.1 `user_preferences.preferred_voice TEXT NOT NULL DEFAULT 'scholar'`

The user's *default for new sessions*. Mutable from the settings page.
This is the column the picker writes to.

### 5.2 `sessions.voice TEXT NOT NULL DEFAULT 'scholar'`

A *snapshot* taken at session creation, from the user's profile
default. Immutable for the life of the session.

### 5.3 Why both, not just one

If voice lived only on the profile: a user who picks `scholar` for six
months, then switches to `woowoo`, would have all their old threads
"re-skinned" the next time they're loaded — but only at the system
prompt level. The actual assistant turns *already on disk* were
generated under the old voice. So a follow-up question to an old
thread would now mix a woowoo system prompt with a thread of
scholar-toned replies, producing tonal incoherence and possibly
contradicting prior framings.

Snapshotting on the session means: the thread's voice is set at
creation and stays. The profile column is purely "what voice should
the *next* session start with."

### 5.4 No per-message picker, no mid-thread swap

Out of scope for v1. If a user wants a different voice, they start a
new session. If we ever want a mid-thread swap, the cleanest model is
to fork a new session rather than mutate `sessions.voice`.

### 5.5 No per-session-creation override

The user said in chat: "users will stick to one voice once they like
it." v1 honors that — there's no "start this one session as woowoo
without changing my default" affordance. Profile change → new session
gets new voice. We can revisit if usage proves otherwise.

---

## 6 Pro gating

Mirrors the model-picker gate (`src/lib/auth.ts:97` `requireTier`,
applied in `src/app/api/query/route.ts:141`).

- **Free user**: settings page does not render the voice picker;
  `/api/preferences` PUT rejects any `preferredVoice !== 'scholar'`
  with 403; query route resolves voice to `scholar` regardless of
  what's stored.
- **Pro user**: picker visible, preferred_voice settable to any
  shipped voice, query route reads `sessions.voice` (which was
  snapshotted from prefs at creation).
- **Pro → Free downgrade**: existing `sessions.voice = 'woowoo'`
  rows keep their voice (the thread coherence argument still applies
  — the prior turns were generated under that voice). New sessions
  resolve to `scholar` because the query route re-checks tier at
  session-create time. This is consistent with how downgraded users
  keep their model history but new sessions get the free model.

---

## 7 Implementation surface

Concrete change list, by file. This is BRD-level, not line-level — the
IMPL doc will spell out diffs.

### 7.1 Migrations

- New migration `012_chat_voice.sql`:
  - `ALTER TABLE user_preferences ADD COLUMN preferred_voice TEXT NOT NULL DEFAULT 'scholar';`
  - `ALTER TABLE sessions ADD COLUMN voice TEXT NOT NULL DEFAULT 'scholar';`
  - No CHECK constraint on the values (validated in app code, same
    pattern as `preferred_model`).

### 7.2 Prompt layer

- `src/lib/prompt.ts`:
  - Replace `SYSTEM_PROMPT` constant with `CORE_RULES`,
    `VOICE_OVERLAY`, `getSystemPrompt(voice)`, and a `VoiceSlug` type
    + `isVoiceSlug()` guard.
  - Keep a `DEFAULT_VOICE = 'scholar'` const for resolution.

### 7.3 Query route

- `src/app/api/query/route.ts`:
  - At session-create time (wherever a new session row is inserted —
    Explore report indicates this is in the query route flow),
    snapshot `voice = isPro ? prefs.preferred_voice : 'scholar'`.
  - At query-execute time, read `session.voice` (not prefs), pass to
    `getSystemPrompt()`.
  - Update the token-estimation line (`route.ts:146`) to use the
    resolved system prompt's length, not the old constant.

### 7.4 Preferences API

- `src/app/api/preferences/route.ts`:
  - Extend GET response with `preferredVoice`.
  - Extend PUT body validation with `preferredVoice` (must be a
    known `VoiceSlug`; non-pro users rejected with 403 if they send
    anything other than `'scholar'`).

### 7.5 Types

- `src/lib/types.ts`:
  - Add `preferredVoice: VoiceSlug` to `UserPreferences`.

### 7.6 Settings UI

- `src/app/(app)/settings/page.tsx`:
  - Add a "Voice" section above or below the model picker.
  - Render a short description per voice (the user sees *what* they're
    picking, not just a slug).
  - Disabled state for free users with a "Pro only" badge, same
    pattern as the model picker.

### 7.7 Chat UI

- Out of scope for v1. The voice is invisible in the chat UI itself.
  If we later want a "you're talking to scholar-guru" affordance, the
  data is already on the session row.

---

## 8 Risks & open questions

1. **Tone bleed across turns in a long thread.** Even with a stable
   system prompt, an assistant trained on its own prior turns may
   drift toward whichever register dominates the history. Mitigation:
   accept this; it's a feature, not a bug, that a long thread settles
   into a register. Eval check: run a 20-turn synthetic conversation
   in each voice and verify the citation block survives to turn 20.
2. **Free user trying to access pro voice via direct API call.** The
   PUT handler must validate server-side; do not trust the UI gate
   alone.
3. **Woowoo copy will need iteration.** The §4.2 sketch is a v0
   draft. The right authoring loop: write copy → run 10 real-ish
   queries → read outputs → adjust. We should treat the initial
   merge of woowoo as a beta and be willing to tune before
   announcing.
4. **Citation behavior under a more lyrical voice is the real
   technical risk.** "Energetic and connection-forward" is exactly
   the tone where models start inventing supporting quotes. The
   CORE_RULES need to be loud enough about no-invention that the
   overlay can't override them. Eval gate before launch: a synthetic
   query set where the retrieved passages *don't* support the obvious
   answer, run under woowoo, and confirm the model still refuses /
   hedges / cites correctly.
5. **What does the picker look like for "Other / custom"?** Answer
   for v1: there is no Other. Curated only. If usage shows a real
   need, that's a future BRD.

---

## 9 What "done" looks like

- A pro user can open settings, see two voices with short
  descriptions, and pick one.
- The pick persists across sessions and reloads.
- A new chat session uses the picked voice; its `sessions.voice` row
  is set at creation.
- Changing the profile voice does *not* change any existing thread's
  behavior.
- A free user attempting to send `preferredVoice: 'woowoo'` to the
  API gets a 403.
- The eval gate from §8.4 passes: woowoo does not produce more
  fabricated citations than scholar on the synthetic adversarial set.
