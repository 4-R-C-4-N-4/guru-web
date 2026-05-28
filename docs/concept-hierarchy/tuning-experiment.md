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

---

# Round 2 (todo:59060e24): fixed-reference diversity + LLM-judged precision

_Run on `todo/59060e24` (= round-1 apparatus + merged stopword fix #81, so the
`the`→Theology noise no longer confounds). Added: a `RETRIEVAL_DIVERSITY=fixed`
variant (pool-independent corpus rarity, in `retrieve()`), the diversity×pool
cross-sweep, and `scripts/eval-precision.ts` (LLM-judged precision@K)._

## What was built

- **Fixed-reference diversity** — `diversity = DIVERSITY_BOOST × rarity(t)`, where
  `rarity` is log-scaled inverse corpus size in [0,1] (rarest = 1, largest = 0),
  computed once from corpus-wide tradition counts and **independent of the live
  pool**. Env-gated (`RETRIEVAL_DIVERSITY=live|fixed`, default `live`).
- **Precision metric** — `eval-precision.ts`: per query × config, retrieve top-10
  and have an LLM (deepseek-v4-pro, temp 0) label each passage relevant/not →
  precision@10. The real relevance signal `headStable` only proxied.

## Results

Cross-sweep (diversity × pool):

| config | tailRecall | anchored | headStable |
|--------|-----------|----------|-----------|
| live ×2 (prod) | 0/2 | 7/7 | 1.00 |
| live ×10 | 2/2 | 7/7 | 0.35 |
| fixed ×2 | 0/2 | 6/7 | 0.61 |
| fixed ×10 | 2/2 | 6/7 | 0.44 |
| fixed ×20 | 2/2 | 6/7 | 0.39 |

LLM-judged precision@10 (mean over 7 queries):

| | live ×2 | live ×10 | fixed ×10 |
|---|---|---|---|
| mean precision@10 | 0.20 | 0.24 | 0.26 |
| `cosmology` | 0.60 | 0.80 | 0.70 |
| `union with the divine` | 0.50 | 0.80 | 0.60 |
| gap queries (Tiamat / Ahura Mazda / Diamond) | ~0.00 | ~0.00 | ~0.07 |

## Findings — three of them overturn round 1

1. **`headStable` over-warned.** It screamed at live ×10 (0.35 = ~60% head churn),
   but the LLM judge says precision actually went *up* (0.20 → 0.24). The churn was
   largely **benign** — the head changed to similarly-or-more relevant content.
   Round 1's "don't ship, it churns 60%" was overly conservative on precision.
2. **Fixed diversity is not a clear win.** ≈ live on precision (0.26 vs 0.24, within
   noise) but it **evicts an anchored tradition even at ×2** — a constant rare-boost
   over-promotes small traditions globally. The decoupling hypothesis is *not*
   validated; it trades one problem for another.
3. **Diversity/pool tuning is not the quality lever.** Across the whole sweep,
   precision moves only ~0.02–0.06 — noise. These knobs are not where retrieval
   quality lives.
4. **The recall "win" is hollow, and the real lever is corpus quality.** Surfacing
   mesopotamian/zoroastrian for their queries yields **precision ~0.00** — the
   chunks that surface aren't relevant. Eyeballing confirmed why: retrieval returns
   **apparatus junk** as content — site boilerplate ("Sacred Texts… Previous Next"),
   tables of contents ("Next: Chapter IV"), and **editorial/manuscript footnotes**
   ("the word 'âidûm' stood… in his MS"). A crude scan flags **~994 / 3089 chunks
   (~32%)** carrying such markers. That junk is the precision ceiling — no ranking
   weight can fix it.

## Verdict

**Stop tuning ranking weights.** Pool-width and diversity are roughly
precision-neutral; the dominant, highest-leverage precision problem is **upstream
chunk quality** (~⅓ of the corpus is polluted with navigation/TOC/editorial
apparatus). The fix is a **pipeline chunk-cleaning / filtering pass** (guru repo),
not a guru-web knob. Captured as a follow-up. The `RETRIEVAL_DIVERSITY` /
`RETRIEVAL_POOL_MULT` knobs stay dormant (defaults preserve current behavior) as
tooling, should we revisit ranking *after* the corpus is cleaned.

> Methodological note: `headStable` (churn vs baseline) is a *cheap proxy* that
> proved misleading on its own — it flagged benign churn as damage. The LLM judge,
> calibrated by eyeballing (good results scored 0.6–0.8; junk scored 0.1), was the
> signal that mattered. Keep the judge in the loop for any future ranking change.

---

# Round 2b (todo:0748677d): retrieval-side quality filter

_Built `RETRIEVAL_QUALITY_FILTER` (env-gated, default off): at query time, **drop**
pure-apparatus chunks (`^Next:`/`^Previous:`/`^Errata`, nav-only-after-strip) and
**strip** the `Sacred Texts … Previous Next` prefix + `{p. N}` markers from bodies.
The bridge to test "tune vs repair" without waiting on the upstream re-export._

LLM-judged precision@10, **filter ON** (vs OFF in parens):

| | live ×2 | live ×10 | fixed ×10 |
|---|---|---|---|
| mean precision@10 | 0.24 (0.20) | 0.24 (0.24) | 0.23 (0.26) |
| `cosmology` | 0.70 (0.60) | **0.90** (0.80) | 0.70 (0.70) |
| `the One … Nous` | 0.20 (0.10) | 0.10 | 0.10 |
| gap queries | ~0.00 | ~0.00 | ~0.03 |

## Findings — the filter is a modest win, not the unlock

1. **It helps where junk took slots, marginally.** Baseline mean 0.20 → 0.24;
   `cosmology` ×10 0.80 → 0.90; `the One` 0.10 → 0.20 (its Egyptian-TOC and
   Chuang-Tzu nav chunks are now dropped). Real, worth keeping as a safety net.
2. **But it is NOT the precision unlock** (hypothesised 0.2 → 0.5; got 0.2 → 0.24).
   Two reasons, both decisive:
   - **It can't re-rank.** The vectors were computed on the polluted text, so the
     *same* chunks are retrieved; stripping their bodies cleans what the judge
     reads but doesn't change *which* chunks surface.
   - **The retrieved chunks are often genuinely off-topic, not merely
     boilerplate-laden.** Gap queries stay ~0.00 because the surfaced
     mesopotamian/zoroastrian chunks are real-but-irrelevant, not nav junk.
3. **Config gaps did NOT widen on the cleaner pool** (still ~0.23–0.24 across
   configs) — so tuning levers *still* show no signal. Confirms again: diversity/
   pool isn't the lever.

## Verdict (tune vs repair — settled)

Neither query-time **tuning** nor query-time **filtering** unlocks precision. The
ceiling is set by **retrieval relevance** — embedding quality + corpus coverage —
which only the upstream fix moves. Critically, that fix must **re-embed on cleaned
text**, not just strip strings: stripping boilerplate from display does ~nothing
for ranking while the vectors still carry it. So `b80d8d7d` is sharpened: **clean
the chunks AND regenerate embeddings**, then re-export.

The quality filter ships as a dormant, default-off **safety net** (drops pure
apparatus, cheap), but it's not a substitute for the re-embed. After the clean
re-embed lands, re-run this harness — *that's* when the tuning levers get their
real test.
