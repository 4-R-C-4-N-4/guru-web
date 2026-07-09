# Holistic review — 2026-06-09 (web-side action items)

A full-system review of `guru` + `guru-web` covering the runtime library,
pipeline scripts, both databases, retrieval implementations, deploy, and
tests. This directory holds the action items that land in **this repo**; the
pipeline-side items live in `guru/docs/review-2026-06-09/`.

## Status check against `docs/retriever-hitlist.md`

All four hitlist bugs are **fixed** in current code (verified 2026-06-09):

- Bug 1 (vector tier silently floored): vector hits are now *explicitly*
  tagged `inferred` with a comment stating why (`retriever.ts:267–281`).
- Bug 2 (flat 0.5 graph distance fallback): replaced by the additive port —
  graph hits contribute a tier-weight signal, not a faked distance
  (`retriever.ts:283–304, 349–364`).
- Bug 3 (order-dependent diversity): diversity now counts the whole candidate
  set first; continuous, order-independent; optional pool-independent
  `RETRIEVAL_DIVERSITY=fixed` corpus-rarity mode (`retriever.ts:328–337, 357–359`).
- Bug 4 (hop-depth docstring + EXPRESSES pollution): `HOP_DEPTH = 1` named
  constant with rationale; `CONCEPT_EDGE_TYPES` excludes EXPRESSES; frontier
  walk supports depth > 1 (`graph.ts:12–30, 253–277`).

The hitlist also asked for a trace flag (done: `RETRIEVAL_TRACE`,
`retriever.ts:369–382`), `mergeAndRerank` unit-testability (done: exported),
and an eval harness (**not done** — see doc 04).

Note: the *Python* retriever in the pipeline repo still has Bug 3 and lacks
the lexical leg — see `guru/docs/review-2026-06-09/04-retriever-parity.md`.

## Things found to be good (no action)

Three-leg retrieval with measured tuning (lexical leg: p@10 0.21→0.37);
CORE_RULES grounding contract with tier-based hedging; streaming that drains
upstream on client disconnect so costs always finalize; dual-axis atomic
budget enforcement with lazy reset; append-only `model_pricing` with
effective-date ranges; tailnet-gated admin that 404s publicly; atomic
symlink-swap deploys with a real incident runbook; 50 test files.

## Action items (priority order)

| # | Doc | One-liner |
|---|-----|-----------|
| 1 | [01-graph-leg-weighting.md](01-graph-leg-weighting.md) | The graph leg is still structurally cheap: phantom graph term for vector-only hits, verified-edge ceiling of 0.3, GRAPH_WEIGHT sweep pending. Decide: recalibrate the additive blend or move to RRF. |
| 2 | [02-semantic-concept-matching.md](02-semantic-concept-matching.md) | Replace keyword-only concept extraction's recall ceiling with concept-definition embeddings (pipeline exports them; this repo matches against them). |
| 3 | [03-corpus-freshness.md](03-corpus-freshness.md) | Staging is on corpus_version 30 (May 29) because dev-setup only reloads on schema_version change. Reload on corpus_version; show freshness in admin. |
| 4 | [04-retrieval-eval-harness.md](04-retrieval-eval-harness.md) | The golden-query eval the hitlist asked for; shared with the pipeline repo; gates HOP_DEPTH/weight/RRF changes. |
| 5 | [05-operational-polish.md](05-operational-polish.md) | Quality-filter default after upstream re-embed, RETRIEVAL_DIVERSITY=fixed default decision, document the env-flag surface in .env.example. |

Companion pipeline-side items: `guru/docs/review-2026-06-09/README.md`.

## Data snapshot backing these docs (2026-06-09)

Staging Postgres: corpus_version 30, exported 2026-05-29, schema_version 3 —
3,128 chunks / 16 traditions / 64 texts / 95 concepts, vs the pipeline SQLite's
4,378 chunks / 21 traditions / 106 concepts. Aliases: 50 concept aliases,
0 family aliases. App tables: 1 user, 3 sessions, 2 queries, 208 pricing rows.
