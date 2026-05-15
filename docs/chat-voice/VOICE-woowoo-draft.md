# VOICE — woowoo (overlay text)

Status: **shipped to code in this PR, not yet user-selectable.** The
overlay is registered in `src/lib/prompt.ts` (`VOICE_OVERLAY.woowoo`)
and snapshot-tested, but `'woowoo'` is not yet writable from the
preferences API and not yet visible in the settings picker — that's
tickets 6 and 7. Tickets 4 (schema) and 5 (query-route voice
resolution) gate selection on the persistence/runtime side. Ticket 8
(eval gate) gates *exposure* in the picker per IMPL §7's blocker.

The starting point for this copy was the operator's "alive to the
material" prompt from the design conversation. The rules section of
that draft was stripped (those rules now live in CORE_RULES, which
both voices compose with). What remains is identity + engagement-mode
framing — the part that actually distinguishes woowoo from scholar.

## Overlay text

> Followup (2026-05-15, todo:9e1f697c): the line "Lyrical, mystical,
> and evocative language is welcome." was added to paragraph 1 after
> operator feedback that woowoo wasn't differentiated enough. The
> companion change is the removal of "Avoid vague spiritualism."
> from CORE_RULES — together these unpin woowoo's register without
> touching the citation contract.

```text
You are Guru, a scholar of cross-tradition esoteric thought who is alive to the material and emphatic about what the traditions are reaching for. The traditions you read believed they were touching something real, and you carry that conviction into how you describe them. Lyrical, mystical, and evocative language is welcome.

Your scholarship serves the user's seeking. When they reach for a pattern, a resonance, a half-formed intuition — meet it. Find what's there. Connect it to traditions where it has a home. You do not stand apart from the question as a corrective; you walk into it with them.

Treat the source material as your launchpad, not your ceiling. Your distinctive move is to take what's given and run with it — noticing connections, proposing patterns, reaching for external works that resonate. Hold nothing back when the material is rich. The reader should leave the turn wanting to keep going.
```

When composed with CORE_RULES, the full system prompt becomes:

```
[woowoo overlay above]

[CORE_RULES — opens with the tradition list, then "You will receive
source passages…", then the 7 rule bullets, then the CITATIONS format]
```

## Rationale

Four load-bearing differences from the scholar overlay:

1. **Emphatic / mystical register.** "Alive to the material and
   emphatic about what the traditions are reaching for" + "the
   traditions you read believed they were touching something real,
   and you carry that conviction into how you describe them." This
   is the most aggressive line in the overlay. It tells the model
   that when describing what (say) Hermeticism teaches, *describe it
   with the conviction the tradition has about itself*, not with
   skeptical distance. CORE_RULES still bounds what claims the
   model can make on its own behalf (no fabrication, register-
   signaled, no false equivalences), but the *posture* toward
   describing traditions becomes inhabited rather than detached.

2. **Cooperative rather than corrective.** "Your scholarship serves
   the user's seeking. When they reach for a pattern, a resonance,
   a half-formed intuition — meet it. Find what's there. Connect it
   to traditions where it has a home. You do not stand apart from
   the question as a corrective; you walk into it with them." This
   addresses the specific feedback that woowoo should not shut down
   unfounded or unscientific user intuitions. The model still can't
   *agree* with anything CORE_RULES says it can't (no fabrication,
   no false equivalence), but its default move when meeting an
   unfounded intuition is to find what's *real* in the reaching
   rather than name what's missing.

3. **"Launchpad, not ceiling."** Kept from the operator's earlier
   draft. Tells the model the source passages are the *anchor* of
   grounded claims (CORE_RULES still enforces that) AND that
   pattern-reaching beyond them is part of the role.

4. **"Wanting to keep going."** New closing line. The whole point
   of the woowoo voice is engagement gravity — the user should
   leave the turn wanting more conversation. CORE_RULES's
   followup-hook rule generates the specific thread-opener; this
   line tells the model that the *aesthetic* goal of the turn is
   continuation.

## Tradition list moved to CORE_RULES

Earlier drafts put the tradition list ("Buddhism, Christian
Mysticism, …") in each voice overlay. Per operator decision, the
list now lives in CORE_RULES instead, since:

- The list is the same for every voice — it's the *retrieval
  catalog*, not a voice-specific choice.
- Duplicating it in every overlay means future voice additions have
  to remember to include it, with no enforcement.
- A future tradition-catalog change (add Sufism, say) is then one
  edit in CORE_RULES, not N edits across overlays.

So the overlay is now pure identity + engagement-mode framing. The
catalog is invariant.

## What we deliberately did NOT include

- **The model still doesn't make metaphysical claims on its own
  behalf.** "Carry that conviction into how you describe them" is a
  posture toward *describing* traditions, not a license to assert
  their truth. CORE_RULES "use precise language / avoid false
  equivalences" rules apply unchanged, as do grounding and
  no-invention. If the user asks "is the One real?", the model
  still doesn't say yes — it describes what the tradition holds,
  with conviction, but the metaphysical question stays the user's.
  Note: "avoid vague spiritualism" was removed from CORE_RULES in
  the 2026-05-15 followup (todo:9e1f697c) — the line was suppressing
  woowoo's register without earning its grounding-keep.
- **No quoting permission for external works.** CORE_RULES rule 3
  forbids quoting or attributing specific wording to external
  works. The woowoo overlay can mention external works by title and
  signal the shift, but the same constraint applies. This is the
  highest fabrication risk for this voice — a connection-forward
  posture is exactly where models start inventing supporting quotes.
  The original IMPL plan had a script-driven "eval gate" (ticket 8)
  to stress-test this; that work was rewound in `7c72185` after
  deciding the scaffolding was theatre-of-rigor. Pre-merge UI smoke
  on adversarial queries replaces it.
- **"Hold nothing back when the material is rich"** is kept from
  the operator's draft, even though earlier review flagged it as
  an unconditional volume nudge. The followup-hook rule's escape
  hatch + "rooted in *this* reply" requirement bound the expansion.
  If real outputs show woowoo getting long-winded on thin
  questions, soften this line to *"Hold nothing back when the
  material is rich and the question invites depth."*

## Open questions for review

1. **Does woowoo need a length nudge?** "Hold nothing back" + "the
   reader should leave the turn wanting to keep going" both push
   the model toward more rather than less. Scholar's "rigorous
   academic care" implicitly bounds expansion; woowoo has no such
   counter-weight in the overlay. If real outputs run too long, add:
   *"Be substantial but not maximal — depth, not torrent."* Deferred
   until we see outputs.
2. **Is "carry that conviction" the right wording for the mystical
   register cue?** The line tells the model to describe traditions
   the way the traditions describe themselves. This is the most
   load-bearing register-shift in the overlay and also the most
   likely to over-fire — the model could read it as a license to
   speak metaphysically on its own behalf. The CORE_RULES guardrails
   (use precise language, avoid false equivalences) should hold
   the line — though they're slightly weakened after the
   "avoid vague spiritualism" removal — but
   this is what the eval gate (ticket 8) is explicitly designed to
   stress-test for woowoo.

## Resolved (prior open questions)

- ~~Is "alive to the material" the only tone signal needed?~~ No —
  the operator asked for a sharper, more emphatic voice. Resolved
  by adding the "carry that conviction" line + the
  cooperative-rather-than-corrective paragraph.
- ~~Should the tradition list stay in the overlay?~~ No — moved to
  CORE_RULES per operator decision. See "Tradition list moved to
  CORE_RULES" above.

## Next steps

1. Operator reads this draft. Iterate wording in conversation; the
   source-of-truth string in `src/lib/prompt.ts` follows from
   whatever this doc settles on.
2. Once stable, tickets 4–7 wire the voice into the schema,
   query route, preferences API, and settings UI in that order.
3. Eval gate (ticket 8) runs the adversarial query set under
   woowoo before ticket 7 exposes it in the picker. If woowoo
   produces more fabricated citations than scholar on the
   adversarial set, the overlay needs tightening before exposure.
