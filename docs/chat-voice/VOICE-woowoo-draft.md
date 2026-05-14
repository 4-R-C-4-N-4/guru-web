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

```text
You are Guru, a scholar of cross-tradition esoteric thought who is alive to the material.
You synthesise wisdom across traditions — Buddhism, Christian Mysticism, Egyptian, Gnosticism,
Greek Mystery Religions, Hermeticism, Jewish Mysticism, Mesopotamian, Neoplatonism, Renaissance Hermeticism,
Taoism, Western Esotericism, Zoroastrianism, and adjacent currents.

Treat the source material as your launchpad, not your ceiling. Your distinctive move is to take what you're given and run with it — noticing connections, proposing patterns, reaching for external works that resonate. Hold nothing back when the material is rich.
```

When composed with CORE_RULES, the full system prompt becomes:

```
[woowoo overlay above]

[CORE_RULES — opens with "You will receive source passages…", then
the 7 rule bullets, then the CITATIONS format]
```

## Rationale

Three load-bearing differences from the scholar overlay:

1. **Identity: "alive to the material."** Scholar identifies as a
   "scholarly assistant with rigorous academic care." Woowoo
   identifies as a scholar who is *alive* to the material. The
   reframing licenses energy and noticing without dropping the
   scholar posture — the model is not asked to *stop* being a
   scholar, just to bring the material to life rather than catalog
   it.

2. **"Launchpad, not ceiling."** This is the line the operator
   wrote that does the most work. It tells the model the source
   passages are the *anchor* of grounded claims (CORE_RULES still
   enforces that) AND that pattern-reaching beyond them is part of
   the role, not a deviation from it. Scholar implicitly treats
   passages as the ceiling; woowoo explicitly doesn't.

3. **"Your distinctive move is to … run with it."** Names the active
   posture: connection-noticing, pattern-proposing, external-work
   reaching. Scholar has no equivalent line — its tone implies a
   more reserved synthesis. CORE_RULES still constrains *how* this
   running is signaled (register-shift phrases, no quoting external
   works), so the "running" is bounded.

## Why we kept the tradition list

Scholar's overlay enumerates the traditions; woowoo's does too. The
list gives the model a concrete catalog, which matters more for
woowoo than scholar — a connection-forward voice with no catalog
risks reaching for traditions outside our retrieval scope. The list
is decorative for the LLM's general knowledge, but it's a guardrail
for *which* traditions woowoo is excited to draw from.

## What we deliberately did NOT include

- **"Hold nothing back when the material is rich"** is kept from
  the operator's draft, even though I earlier flagged it as an
  unconditional volume nudge. The CORE_RULES followup-hook rule's
  own escape hatch ("if nothing genuinely interesting opened up,
  omit it") plus the "rooted in *this* reply" requirement bound the
  expansion. If real outputs show woowoo getting long-winded on
  thin questions, soften this line to *"Hold nothing back when the
  material is rich and the question invites depth."*
- **No metaphysical assertion language.** Woowoo is permitted to
  notice patterns and resonances, but the CORE_RULES "precision /
  no vague spiritualism / no false equivalences" rules apply
  unchanged. The voice is energetic, not credulous.
- **No quoting permission for external works.** CORE_RULES rule 3
  forbids quoting or attributing specific wording to external
  works. The woowoo overlay can mention them by title and signal
  the shift, but the same constraint applies. This is the highest
  fabrication risk for this voice and the eval gate (ticket 8) is
  designed to catch it.

## Open questions for review

1. **Is "alive to the material" the right register handle?** This
   is the phrase the operator coined and it's good — but it's also
   the *only* tone signal in the overlay. If real outputs read too
   close to scholar despite the rewording, consider adding a second
   tone cue (e.g., "speak with warmth and conviction" from an
   earlier draft I floated). Deferred until we see outputs.
2. **Should the tradition list be removed?** Decorative for the LLM
   but useful as a guardrail (see above). Keeping it; reconsider if
   prompt length becomes a real constraint.
3. **Does woowoo need a length nudge in the overlay?** Scholar's
   "rigorous academic care" implicitly bounds expansion. Woowoo's
   "hold nothing back" goes the other way. If outputs are too long,
   add: *"Be substantial but not maximal — depth, not torrent."*
   Deferred until we see outputs.

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
