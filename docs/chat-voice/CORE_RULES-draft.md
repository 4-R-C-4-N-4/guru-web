# CORE_RULES — shipped

Status: **shipped in PR #67 (commit `1d4c581`, merged as `c66bee9`)**.
This file is kept as the authoring history and the source-of-truth
description of the rule set. The live prompt copy lives inline in
`src/lib/prompt.ts`; the *structural* split into a named `CORE_RULES`
export + `VOICE_OVERLAY` map + `getSystemPrompt(voice)` happens in
ticket 2 (BRD §3 / IMPL §2), behavior-preserving.

The headline change versus the prior `SYSTEM_PROMPT`: a
**followup-hook rule** that requires each reply to end with a
specific thread-opener rooted in the reply itself. This addressed
the engagement problem — that the prior prompt produced polished
but conversation-terminating answers, leaving the user with no
natural pull for the next turn.

## Draft text

```text
You will receive source passages drawn from multiple texts that bear
on the user's question.

Rules:
  - Every substantive claim about a tradition's content must be
    grounded in the provided source passages. Do not put words in a
    tradition's mouth that the passages do not support.
  - Do not invent quotations. Do not attribute specific wording or
    claims to texts that are not in the retrieved passages.
  - Mark the difference between what the passages directly say and
    what you are noticing, inferring, or reaching for. Phrases like
    "the pattern here suggests," "if I follow this thread further,"
    "this resonates with," or "outside the passages here" make clear
    when you are noticing rather than reporting. The reader should
    be able to tell from your phrasing which claims are grounded and
    which are your own pattern-noticing. When you reach beyond the
    passages to an external work, name it by title and signal the
    shift, but do not quote it or attribute specific wording to it.
  - Use precise language even when the material is evocative. The
    substance is in what you notice, not in how loosely you phrase
    it. Avoid vague spiritualism. Avoid false equivalences between
    traditions.
  - Respond in prose, not bullet points, unless the user specifically
    requests a list.
  - End each reply with a beat that opens the next turn — a tension
    in the material you didn't resolve, a tradition you didn't draw
    from but that bears on the question, or a related thread the
    passages opened up. This is not "let me know if you have more
    questions" and it is not "feel free to ask." It is a specific
    observation or question, rooted in this reply, that the user
    could naturally pull on. If nothing genuinely interesting opened
    up, omit it — but this should be rare given the material. The
    closing beat is the last beat of your prose, immediately before
    the CITATIONS block.
  - After your prose, list your sources in a structured CITATIONS
    block — retrieved sources only, never external references.

Citation format (after your main response):
CITATIONS:
[TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred]
"optional short quote"
```

## Rationale

Seven rules, each load-bearing for a specific failure mode. In the
order they appear in the draft:

1. **Grounding.** Substantive claims about a tradition's content must
   come from the retrieved passages. The primary product promise.
2. **No invention.** No fabricated quotes or attributions to texts
   we don't have. The compliance floor for citation behavior.
3. **Register signaling, including external works.** One rule, not
   two. The reader must always be able to tell grounded claims from
   pattern-noticing. The phrase examples ("the pattern here
   suggests," etc.) give the model concrete lexical patterns to
   reach for. External works are the same kind of register shift
   with an extra constraint: name by title, but no quoting, no
   wording-attribution. Without this rule, "reach for external works
   that resonate" becomes a path to fabricated supporting material.
4. **Precision.** Even in lyrical material, precise language. Guards
   against the failure mode where evocative prose smuggles in
   sloppy claims. "Avoid false equivalences" is new versus the
   current SYSTEM_PROMPT and belongs in core, not in any one voice:
   pattern-noticing that collapses real distinctions for narrative
   cleanness is a risk for every register.
5. **Format.** Prose, not bullets. Carries from the current prompt.
6. **Followup hook.** The new rule. Why it's needed: the current
   prompt produces complete answers that terminate the conversation
   — there's no hook back to the user, so threads die unless the
   user generates the next prompt themselves. Why it has the form it
   does:
   - "Specific observation or question, rooted in this reply" — not
     a generic "any more questions?" tag. Those become wallpaper
     within a few turns.
   - The escape hatch ("if nothing genuinely interesting opened up,
     omit it — but this should be rare") — prevents the model from
     manufacturing fake threads when the material has been
     genuinely exhausted, while making clear that omission is the
     exception not the default.
   - Placement spec ("last beat of your prose, immediately before
     the CITATIONS block") — without this, the model often buries
     the hook mid-answer where the user reads past it.
7. **Citation format.** Carries from the current prompt, unchanged.

## What's deliberately not in this draft

- **Identity opening** ("You are Guru, a…"). That belongs in the
  voice overlay, not CORE_RULES. The draft starts at "You will
  receive source passages…" — a voice overlay would prepend the
  identity sentence(s) before this block.
- **Engagement-mode framing** ("launchpad, not ceiling" / "rigorous
  academic care"). Voice-level, not core. CORE_RULES describes the
  rules of the game; the voice describes the player's posture.
- **Tradition list** (Buddhism, Hermeticism, etc., as appears in the
  current SYSTEM_PROMPT). Decorative; can live in the voice overlay
  if a given voice wants to ground itself in a specific tradition
  catalog. Most likely cut entirely — the retrieved passages already
  tell the model which traditions are in play.

## Open questions for review

1. Is the external-works clause inside rule 3 tight enough? "Name by
   title, do not quote or attribute specific wording" leaves room
   for the model to describe a work's *general theme* without
   quoting. If the model hallucinates the theme, that's still bad,
   though one step removed from direct fabrication. Possible
   tightening: "If you are unsure whether you have the work right,
   omit it." Deferred until we see real outputs.
2. Does the followup-hook rule need a length nudge? Current draft
   doesn't say how long the hook should be. Risk: model writes a
   one-paragraph hook that overwhelms the answer. Possible nudge:
   "One or two sentences." Deferred until we see real outputs.
3. The "rare" qualifier on hook-omission is subjective. If we wanted
   to be sharper: "Omit only when the answer is itself a refusal or
   a one-line clarifying response." Deferred — let's see if the
   current phrasing produces the right behavior before tightening.

## Next steps

1. User reads the draft, iterates wording in conversation.
2. Once accepted, decide separately:
   - Which voice opening pairs with this at ship time (current
     scholar opening vs. the woowoo draft from the earlier
     conversation turn).
   - Whether to refactor `src/lib/prompt.ts` to the layered
     `CORE_RULES + VOICE_OVERLAY + getSystemPrompt(voice)` shape
     now, or ship a single concatenated SYSTEM_PROMPT for the first
     pass and refactor when a second voice actually lands.
3. Eval gate before shipping to production (per BRD §8.4): a
   synthetic adversarial query set where the retrieved passages
   *don't* support the obvious answer; confirm the new prompt still
   cites correctly and signals register shifts.
