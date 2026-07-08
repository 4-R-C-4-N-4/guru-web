# 01 — Graph-leg weighting: phantom term, low ceiling, and the RRF question

## Problem statement

The graph leg exists to surface cross-tradition connections that vector search
cannot see (zero-token-overlap parallels like pleroma ↔ ein sof). The
hitlist-era bugs that *suppressed* it are fixed, but in the current additive
formula the leg is still structurally cheap, for three compounding reasons.
The retriever's own comments acknowledge the symptom:

```ts
// retriever.ts:65-68
// GRAPH_WEIGHT env-tunable too (todo:dafd05d2): now that concept_aliases is
// populated, the graph leg surfaces transliteration content no other leg
// reaches — but at the default 0.3 those chunks lose top-K slots to vector
// hubs. Swept without a redeploy; default is GRAPH_WEIGHT until measured.
```

### Reason 1: vector-only hits receive a phantom graph term

```ts
// retriever.ts:349-363 (abridged)
const tierW = tierWeight(entry.tier);                       // vector-only ⇒ 'inferred' ⇒ 0.4
const graphTerm = Math.max(tierW, entry.graphScore) * entry.matchWeight;  // ⇒ max(0.4, 0) = 0.4
...
const score = VECTOR_WEIGHT * entry.similarity + graphWeight * graphTerm + lexTerm + diversity;
```

A chunk that **no graph edge reached** still gets
`graphWeight × 0.4 = 0.12` of graph score, because `tierW` (floored at the
`inferred` weight 0.4) participates in the `max`. This is a faithful port of
the pipeline formula (`guru/retriever.py:289` does the same), so it is
long-standing — but it means the term labelled "graph" is really
"graph-or-baseline-0.12".

Within the vector leg it's a constant (no reordering). Across legs it
matters: it shrinks the advantage a *real* graph hit gets.

### Reason 2: the ceiling a verified edge can add is small

Best case for a graph signal on a chunk the vector leg also found:
`0.3 × (1.0 − 0.4) = 0.18` net over its phantom baseline — equivalent to just
0.26 of cosine similarity (at `VECTOR_WEIGHT 0.7`). For a graph-*only* hit
(similarity 0): max total `0.3 × 1.0 + diversity ≈ 0.3–0.4`, while mid-pack
vector hits score `0.7 × 0.55 + 0.12 ≈ 0.5`. A verified cross-tradition
parallel that vector search can't see still rarely cracks top-K. That is the
exact failure mode the graph was built to prevent.

### Reason 3: the knobs interact and none of it is measured yet

`GRAPH_WEIGHT` (0.3), `MATCH_TIER_WEIGHTS` (1.0/0.5/0.25), `TIER_WEIGHTS`
(1.0/0.7/0.4), and the phantom floor all multiply into the same term. Sweeping
`GRAPH_WEIGHT` alone (the pending todo:dafd05d2) can't separate "weight too
low" from "floor too high".

## Design — two candidate directions

### Option A: recalibrate the additive blend (incremental)

1. **Remove the phantom term**: make the graph term zero for chunks with no
   graph signal —

   ```ts
   const graphTerm = entry.graphScore > 0
     ? Math.max(tierW, entry.graphScore) * entry.matchWeight
     : 0;
   ```

   This is a deliberate divergence from the Python formula — record it (or fix
   both; see pipeline doc 04). All vector-only scores drop by a constant 0.12,
   so within-leg order is unchanged; cross-leg calibration becomes honest.
2. **Re-sweep `GRAPH_WEIGHT`** on the golden set (doc 04) *after* step 1 —
   plausible range 0.3–0.6 once graph hits aren't competing against their own
   floor.
3. Keep everything else: the additive shape, match weights, tier weights.

Pros: small diff, interpretable, trace output stays meaningful.
Cons: still mixing a [0,1] cosine with categorical tier weights; every future
leg re-opens the calibration question.

### Option B: Reciprocal Rank Fusion (structural)

Replace the cross-leg *score* blend with rank fusion: each leg ranks its own
candidates by its own native signal (vector: cosine; graph: tier × matchWeight;
lexical: ts_rank), then

```
score(chunk) = Σ_legs  w_leg / (k + rank_leg(chunk))        // k ≈ 60, standard
```

with tier/diversity as post-fusion adjustments. This was already sketched as
the preferred resolution in `docs/retriever-hitlist.md` (Bug 2 option b and
the "Bugs 1+2+3 as one scoring redesign" note) before the additive port was
chosen instead.

Pros: incompatible scales stop being a problem *by construction*; phantom-term
class bugs can't exist; adding leg #4 (e.g. semantic concept matching, doc 02)
is trivial.
Cons: discards the tuned lexical-weight sweep result (would need re-sweeping
`w_leg`s); rank-based scores are less directly interpretable in
`RETRIEVAL_TRACE`; diverges further from the pipeline retriever unless ported
both ways.

### Recommendation

Do **A** now (it's a two-line change plus a sweep, and step 1 is a
prerequisite for any honest measurement), and make the A-vs-B call with data
once the eval harness (doc 04) exists. If the harness shows the additive blend
needs per-leg recalibration *again* after the semantic leg lands, that's the
signal to pay for B.

## Also in scope

- `walkGraph` traverses `CONCEPT_EDGE_TYPES = ['PARALLELS', 'DERIVES_FROM']`
  (graph.ts:30) — concept↔concept only. Chunk-level CONTRASTS edges (once the
  pipeline mines them — `guru/docs/review-2026-06-09/03-contrasts-mining.md`)
  don't flow through this walk at all; decide how contrast edges should
  surface (likely: a chunk-to-chunk expansion step from already-retrieved
  anchors, like the Python `_graph_walk`'s PARALLELS hop, which the TS side
  currently doesn't replicate).

## Acceptance criteria

- A chunk with no graph edge contributes exactly 0 to the graph term
  (unit test on exported `mergeAndRerank`; the trace line's `graphS`/`tierW`
  product confirms).
- A verified graph-only hit on a golden cross-tradition query lands in top-K
  where it previously didn't (the pleroma/ein-sof class of queries).
- `GRAPH_WEIGHT` default updated from a measured sweep, with the sweep results
  appended to `docs/concept-hierarchy/tuning-experiment.md` like the lexical
  rounds.
- Decision (and rationale) on RRF recorded here either way.
