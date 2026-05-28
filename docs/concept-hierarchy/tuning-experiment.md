# Retrieval pool-width tuning experiment

_todo:60466c56. Corpus v27 (local). Lever: `RETRIEVAL_POOL_MULT` — the vector
candidate-pool multiplier in `retrieve()` (`vectorSearch(…, topK * mult)`).
Harness: `scripts/eval-tuning.ts`._

## Question

Small / under-showing traditions (mesopotamian, zoroastrianism, buddhism) never
surface for their distinctive queries (golden `knownGaps`). A diagnostic probe
showed the bias is at **candidate generation** — they're filtered out of the
narrow top-N pool before reranking. Does widening the pool fix it *without*
hurting the common case?

## Method

Swept `RETRIEVAL_POOL_MULT ∈ {2, 6, 10, 15, 20}` over a fixed query set (16
golden queries + 2 gap queries), holding corpus + code constant. Metrics:

- **tailRecall** — of the 2 knownGaps, how many now surface their tradition (upside).
- **anchored** — of the 7 tradition-anchored golden queries, how many still recall
  their must-include tradition (no-eviction guard).
- **headStable** — mean top-5 chunk-id overlap vs the `x2` baseline (label-free
  **precision proxy**: a fair-surfacing lever should perturb the tail, not churn
  the trusted head). `1.00` = head unchanged.
- **avgMs** — mean `retrieve()` latency.

## Results

| poolMult | tailRecall | anchored | headStable | avgMs |
|----------|-----------|----------|-----------|-------|
| ×2 (baseline) | 0/2 | 7/7 | 1.00 | 90* |
| ×6  | 1/2 | 7/7 | 0.50 | 18 |
| ×10 | 1/2 | 7/7 | 0.35 | 19 |
| ×15 | 2/2 | **6/7** | 0.46 | 18 |
| ×20 | 2/2 | 7/7 | 0.36 | 20 |

\* ×2 = 90ms is first-run Ollama warmup, not pool cost — real latency is flat ~18–20ms.

## Findings

1. **Tail recall is real.** A wide pool surfaces the gap traditions (×15/×20 → 2/2):
   the relevant rare chunks exist and rank fine *once they reach the reranker*.
2. **Latency is a non-issue.** Flat ~18–20ms across ×6–×20; pool width at this
   scale is cheap (HNSW + in-memory scoring).
3. **But precision pays for it — the catch.** `headStable` collapses to ~0.35–0.50:
   widening the pool churns **half-or-more of the trusted top-5** on the common
   queries, and at ×15 it even **evicted an anchored tradition** (6/7). This isn't
   gentle tail-surfacing; it's a ranking inversion.

### Root cause

The diversity term is `DIVERSITY_BOOST / traditionCount`, counted over the
candidate set. Widening the pool changes that distribution — big traditions get
many candidates (tiny per-chunk bump), rare traditions get few (full bump) — so
rare content **leapfrogs similarity-ranked results into the head**. Candidate
fairness and rarity scoring are **coupled through the diversity denominator**, so
you can't widen the pool without destabilizing the ranking.

## Verdict

**Do not ship pool-width tuning as-is.** It trades the recall gap for a precision /
stability problem — the breadth-masks-precision trap, inverted. The earlier
single-query probe ("mesopotamia at rank 3, looks great") would have shipped a
change that churns ~60% of results; the precision guard is exactly what caught it.
This vindicates keeping tuning out of the migration PR (#79).

## Next steps (→ follow-up)

1. **Decouple candidate fairness from rarity scoring.** Options: compute diversity
   over a fixed reference distribution (not the live pool); cap diversity's share
   of the score; or separate a stratified candidate floor (fair *consideration*)
   from the rarity *rerank* so the two don't compound.
2. **Add a relevance-labeled precision sample** (human/LLM-rated) so head churn can
   be judged benign (different-but-relevant) vs harmful (relevant displaced) —
   `headStable` measures churn, not correctness.
3. **Re-sweep with the redesigned diversity term**, then decide.

## Status

Nothing shipped. The `RETRIEVAL_POOL_MULT` knob (default 2 — behavior unchanged)
and `scripts/eval-tuning.ts` are committed on `todo/60466c56` as the tuning
apparatus for the next round.
