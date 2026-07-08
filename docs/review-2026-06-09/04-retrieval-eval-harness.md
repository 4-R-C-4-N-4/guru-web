# 04 — Golden-query retrieval eval harness (shared with the pipeline)

## Problem statement

Every open retrieval question in both repos is currently blocked on the same
missing artifact:

- `docs/retriever-hitlist.md` ("What I'd want to see before merging fixes"):
  *"a small evaluation harness … Without this, 'did the fix help?' is
  unanswerable."* The bugs were fixed; the harness never landed.
- `graph.ts:17–21`: HOP_DEPTH frozen at 1, to be bumped *"only alongside the
  retrieval eval harness."*
- `retriever.ts:65–69`: GRAPH_WEIGHT sweep pending measurement (todo:dafd05d2).
- Review docs 01 (weighting/RRF), 02 (semantic matching threshold), and 05
  (quality-filter default) all gate on it.
- Pipeline doc 04 (retriever parity) needs it to detect cross-repo drift.

The tuning that *has* happened (lexical weight sweep, matcher mode comparison
in `docs/concept-hierarchy/tuning-experiment.md`) shows the methodology
already exists informally — query sets, p@10, per-round notes. This item is
"promote that methodology to a committed, runnable artifact."

## Design

### The golden set

One TOML file, vendored identically in both repos (`eval/golden-queries.toml`
here and in `guru/`), so either side can run it and a diff tool can compare:

```toml
schema = 1

[[query]]
id = "divine-light-immanence"
class = "cross-tradition-concept"
text = "How does divine light appear as immanent in creation?"
expect_traditions_top10 = ["gnosticism", "jewish_mysticism", "hermeticism"]
expect_chunks_any = ["gnosticism.gospel-of-thomas.077"]

[[query]]
id = "ahura-mazda"
class = "entity"                       # lexical-leg regression guard
text = "Ahura Mazda"
expect_traditions_top10 = ["zoroastrianism"]
min_expected_tradition_hits = 3

[[query]]
id = "becoming-like-god"
class = "paraphrase"                   # semantic-matching target (doc 02)
text = "becoming like God through inner transformation"
expect_concepts_expanded = ["theosis_deification"]

[[query]]
id = "scoped-gnostic-demiurge"
class = "scoped"
text = "What is the demiurge?"
scope_whitelist = ["gnosticism", "hermeticism"]
expect_no_traditions = ["buddhism"]    # scope-leak guard (mirrors test_preferences)

[[query]]
id = "negative-control"
class = "negative"
text = "What does the corpus say about quantum computing?"
expect_max_results_above_sim = 0       # nothing should pass min_similarity
```

Classes to cover (≥ 2–3 queries each): cross-tradition concept, entity/proper
noun, paraphrase, scoped, negative control, and graph-only (a known
PARALLELS pair whose vocabulary doesn't overlap — the pleroma/ein-sof class —
which is the direct measure of doc 01's fix).

### The runner (this repo)

`scripts/eval-retrieval.ts`: loads the TOML, calls `retrieve()` directly (no
HTTP, no LLM — retrieval only), and emits:

```
divine-light-immanence   p@10 0.60   traditions 3/3   PASS
ahura-mazda              p@10 0.80   traditions 1/1   PASS
becoming-like-god        expansion MISS (no graph leg fired)        FAIL
...
mean p@10 0.42 | 11/13 PASS | trace: eval-out/2026-06-09.json
```

- Per-query structured output (top-K ids, per-chunk score components — reuse
  the `RETRIEVAL_TRACE` breakdown, which was deliberately kept as the real
  scoring path, retriever.ts:348) written to a JSON file for diffing between
  runs and against the Python runner.
- Env-flag passthrough so sweeps are loops over the runner
  (`RETRIEVAL_GRAPH_WEIGHT=0.4 npm run eval-retrieval`).
- Exit nonzero if any `PASS`-required query fails — CI-able. Mark known-flaky
  expectations `advisory = true` rather than deleting them.

The existing `retrieval.integration.test.ts` golden cases ("divine spark",
"atman brahman") fold into the TOML so there's one source of truth.

### Cross-repo drift check

Both runners write the same JSON shape (`{query_id: [chunk_ids...]}`); a small
script (either repo) reports rank-set deltas. Threshold: tradition-coverage
parity required, exact rank equality not (different vector backends). See
`guru/docs/review-2026-06-09/04-retriever-parity.md`.

### What this is not

Not an answer-quality/LLM eval. Citation correctness, hedging language, and
generation faithfulness are separate concerns with separate (existing) tests.
Keeping the harness retrieval-only keeps it fast (<10s), free, and runnable in
CI against the seeded dev corpus or a full staging load.

## Sequencing

This doc is a **prerequisite** for docs 01/02/05 and pipeline doc 04 — build
it first, on the current corpus, *before* changing scoring, so the first run
is the baseline that every subsequent change diffs against.

## Acceptance criteria

- `npm run eval-retrieval` runs against the locally loaded corpus and prints
  per-query and aggregate results in <10s with no LLM/API calls.
- Baseline JSON committed (or stored in `eval-out/` with the run date) before
  any scoring change lands.
- The graph-only query class fails on current scoring (documenting doc 01's
  problem) or passes — either way the result is recorded in doc 01.
- Same TOML file present and runnable in the pipeline repo.
