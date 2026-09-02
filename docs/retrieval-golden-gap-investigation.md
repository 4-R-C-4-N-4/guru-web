# Retrieval golden-gap investigation — `guru-web`

**todo:697f9e58** · corpus v63 · written 2026-09-01

The full record of the investigation that began when "the latest (biggest yet)
text booped some texts out of successful retrieval in the golden query set,"
from first exploration through the per-work-cap experiment. It is written so a
future reader can see *what was tried, what the data actually said, and why the
shipped defaults are what they are* — not just the conclusion.

Files touched: `src/lib/retriever.ts`, `src/lib/graph.ts`,
`src/__tests__/fixtures/golden-queries/*.json`,
`src/__tests__/golden-retrieval.test.ts` (deprecated).

---

## 0. The trigger

The newest, largest corpus load — **blavatsky-sd** (*The Secret Doctrine*, 727
chunks, tradition `theosophy`) — coincided with primary texts dropping out of
the golden query set. The initial ask was to look at the golden set's
success/fail and find what could be done better.

The corpus at the time: 6,743 chunks, all embedded (`nomic-embed-text`, 768d),
loaded into the docker Postgres the app serves. blavatsky-sd present with all
727 chunks.

---

## 1. Two golden sets, and a mis-calibrated canary

There turned out to be **three** distinct artifacts, which had been conflated:

| artifact | what it is | asserts |
|---|---|---|
| `scripts/golden-check.ts` | ad-hoc staging script (8 hand-picked probes: blavatsky + a few regressions) | expected text in **top-8** |
| `src/__tests__/golden-retrieval.test.ts` | original frozen gate, 14 queries, pinned corpus v37 | tradition-anchored / hierarchy |
| `src/__tests__/golden-queries.test.ts` | **per-work** set, one fixture per `corpus.works` id | tradition (+ optionally work) in **top-15** |

The first finding was a **harness bug, not a retrieval bug**: `golden-check.ts`
graded a **top-8** cut while production (`api/query/route.ts`) serves **top-15**
(`retriever.ts` default `topK = 15`). Worse, the intake pools scale with `topK`
(`vectorSearch(q, topK*10)`, graph/lexical `topK*2`), so `retrieve(q, 8)` and
`retrieve(q, 15)` are *different computations* — not a prefix relationship. The
canary was both stricter than prod and exposing pool-starvation.

Aligning it to top-15 recovered 2 of the "failures" (kybalion, book-of-the-dead)
as pure canary artifacts. **Lesson: steer by `golden-queries.test.ts`, not the
staging script.** `golden-check.ts` is retained but should be treated as a smoke
test, never a source of truth.

---

## 2. What was *already* failing vs. what blavatsky broke

Chasing the `golden-check.ts` phrasing led down a wrong path (wu-wei / Nous /
`corpus-hermeticum-01`) that turned out to be canary-specific, not real-gate
failures. Correcting to the **frozen per-work set** reorganised the picture
entirely:

- **The per-work gate was healthy.** 180 recall-probes over 62 covered works:
  **149 exact provenance-chunk hits (83%)**, 18 same-text-neighbour (10%) → 93%
  land the right passage or its neighbour. Only **6 works** failed
  `mustIncludeWork`.
- **None of the "problem children" I first chased were real gate failures.**
  sefer-yetzirah, tao-te-ching, corpus-hermeticum all *pass* the frozen set
  cleanly — their apparent failures were `golden-check.ts` artifacts.
- A tagging "gap" I asserted (`wu_wei` untagged) was a **query bug on my end**:
  I filtered docker with `target='wu_wei'` when ids are prefixed `concept.wu_wei`.
  wu_wei has 74 EXPRESSES edges on tao-te-ching. No tags were missing.

So blavatsky did not "break" the corpus. The real failures were a small,
pre-existing set of hard cases, and blavatsky's role was as a *crowder* (§5),
not a corruptor.

---

## 3. Coverage completion (the 7 missing fixtures)

The corpus had 69 works but only 62 fixtures. Seven works had **no golden
coverage at all** — including blavatsky-sd itself, the text that started this.
Authored per-work fixtures (drafted from real chunks, paraphrased against FTS
circularity, reader-honest anchors only) for all seven:

`blavatsky-sd`, `apocryphon-of-john`, `gospel-of-judas`,
`yoga-sutras-book-01..04`.

Result: **69/69 works covered**, 25 new recall-probes + 13 relevance, all
independently verified surfacing their work into top-15. Shipped as **PR #133
(merged)**, which also **promoted `golden-queries.test.ts` to source of truth**
and **deprecated `golden-retrieval.test.ts`** (frozen legacy at v37; its one
stale assertion — "the One and emanation from the Nous" — moved into that file's
`knownGaps` since it fails identically regardless of ranking).

**blavatsky-sd is fully covered and passes its own gate.** Nothing outstanding
there.

---

## 4. The walkGraph ordering bug (and the graph-weight dead end)

Investigating why no tuning knob moved the hard cases surfaced a real defect in
the graph leg. `walkGraph` selected co-expressor chunks with:

```sql
SELECT ... FROM chunks WHERE id = ANY($1) AND <scope> LIMIT $n
```

— **no `ORDER BY`.** It `LIMIT`ed an *unordered* scan, handing the reranker an
arbitrary DB-order sample of every chunk expressing any matched concept. No
weight could then promote the right chunk (a graph-weight sweep just amplified
whichever arbitrary hits it returned — e.g. flooding a Sefer Yetzirah query with
Mabinogion). The leg was also **nondeterministic**, flapping run to run.

Fix: rank co-expressors by relevance (Σ match-weight over the *distinct* matched
concepts a chunk expresses) before limiting, with a deterministic id tiebreak.

**Measured on the frozen set at the shipped graph weight (0.3):**

| ordering | missing works | deterministic |
|---|---|---|
| off (original unordered LIMIT) | 7 | no |
| **on** | **6** | **yes** |

So ordering-on is a small net win (recovers `dionysius-mystical-theology`) and
removes the nondeterminism → **shipped ON** (`RETRIEVAL_GRAPH_RANK=off` is the
kill-switch).

**The graph-weight lever was a dead end.** Raising `RETRIEVAL_GRAPH_WEIGHT` to
lean on the ranked leg *net-regressed* the frozen set (6 → 12/13 missing works),
because the remaining gaps are narrative-recall the graph leg cannot reach.
Weight stays at its 0.3 default. (An early "5/8 → 6/8" headline was on the
`golden-check.ts` canary and did not survive re-validation on the real set.)

Cosine dup-collapse was also prototyped (`RETRIEVAL_DUP_COLLAPSE`): it improves
head diversity (+15% distinct texts across the golden heads) but does **not**
move the binary gate, so it ships **opt-in, off**.

This is **PR #132** (walkGraph ranking on/deterministic + opt-in dup-collapse +
the per-work cap of §6).

---

## 5. The six real failures — what they return, and why

At the shipped config (ranking on, default weights), the frozen gate has **6
failing recall-probes across 6 works**. Each was run at the exact gate config
(top-15, scope=all) and the full top-15 captured. The unifying force is a
**fluency inversion**: a modern synthesis in clean prose out-embeds the archaic
primary. **blavatsky-sd appears in 5 of the 6 heads.**

To distinguish *crowding* (target scored high, pushed below the cut) from
*recall miss* (target scored low or absent), the exact top-15 candidate pool was
reproduced and fully scored **without truncation**, reading each target's true
rank and which works hold the slots above it:

| work | expected tradition | target's true score-rank | who crowds above it |
|---|---|---|---|
| poetic-edda-voluspo | norse | 36 / 205 | **blavatsky:19**, secret-teachings:3 |
| paracelsus-aurora | renaissance_hermeticism | 16 / 175 | blavatsky:2, secret-teachings:2 |
| pistis-sophia | gnosticism | 19 / 202 | *(none — max 2/work)* |
| mabinogion | celtic | 25 / 207 | **kalevala:6**, blavatsky:2 |
| iamblichus-on-the-mysteries | neoplatonism | 48 / 203 | **blavatsky:18**, plotinus:7, boehme:5 |
| isa-upanishad | upanishads | **ABSENT from the 202-pool** | blavatsky:32, +30 others |

This decomposes the "one bug" into **three distinct causes**:

1. **Crowding, cap-fixable (2):** poetic-edda, paracelsus. A big work sits above
   an otherwise rank-16–36 target.
2. **Too deep for a cap (2):** iamblichus (rank 48), mabinogion (rank 25). Even
   removing every duplicate, too many *distinct* works are above. mabinogion's
   top crowder is **Kalevala** — a genuine parallel dying-hero myth, arguably
   *correct* retrieval failing a work-level assertion.
3. **Genuine recall failures (2):** pistis-sophia (rank 19, **no crowder** — a
   pure scoring miss) and isa-upanishad (**never retrieved into the candidate
   pool** — no reranking cap can fix what the vector/lexical/graph legs never
   fetched).

Two structural aggravators, both measured:
- **blavatsky's omnipresence is real and counted** — 18–32 of the top scored
  slots in three of these queries. (In the *emitted* top-15 the per-tradition
  cap already limits it to 3; the 18–32 is its share of the pre-cap scored pool.)
- **Thin traditions have no safety net.** `celtic` and `upanishads` are **single
  text** each — the work missing = the tradition missing, so there is no sibling
  to satisfy `mustIncludeTraditions`.

A separate correctness check: **blavatsky's tags are genuinely semantic, not
lexical.** Of its 4,772 EXPRESSES edges, 89% do not contain the concept's full
label and **58% share not one content word** with it — a keyword matcher cannot
produce those. So the crowding is not a tagging artifact; the concept layer is
inferring category from meaning.

---

## 6. The max-per-work cap experiment

The proposed fix was a per-work slot cap (analogous to `MAX_PER_TRADITION = 3`,
but per `text_id`, since an omnibus that is nearly its whole tradition slips
under the tradition cap). It was **implemented and measured**, not assumed.

Design (`retriever.ts`, `MAX_PER_TEXT`):
- Env `RETRIEVAL_MAX_PER_TEXT` (number retunes, `off` disables). **Ships OFF
  (0)** — a no-op verified byte-identical to prior behaviour.
- **Study-mode aware:** disabled (0) when a study work is pinned, so a reader
  asking about one book still gets many of its passages.
- **Starvation mitigation (backfill):** if a narrow whitelist/blacklist leaves
  fewer than `topK / cap` works, the per-text cap is relaxed for the leftover
  slots so results are never short of topK. Verified: cap=1 + 5-text whitelist
  returns 13 (not 5); the per-tradition cap remains the only other binding limit.
- Monotonically safe for the golden assertions: the cap only ever removes a
  work's *2nd+* chunk, never its first appearance or its tradition, so it can
  help `mustIncludeWork` / `mustIncludeTraditions` but never break them.

**Full 320-probe golden gate, ranking on:**

| config | passed / failed | golden failures recovered |
|---|---|---|
| baseline (no per-work cap) | 314 / 6 | — |
| **cap = 2** | 314 / 6 | **0** |
| **cap = 1** | **316 / 4** | **2** (paracelsus + poetic-edda) |

Both matched the pre-run simulation exactly. **No regression at any value.** The
4 still failing at cap=1 are precisely the non-cap-fixable cases from §5
(iamblichus, isa-upanishad, mabinogion, pistis-sophia).

**Verdict: the cap works exactly as measured, but it is a weak lever.** Only
cap=1 helps, cap=1 is the UX-aggressive setting (one chunk per work would hurt a
normal single-book chat question), and it buys only 2 of 6 recoveries. The data
argues **against enabling it by default** — hence it ships OFF, available as a
tool for study/experiment via `RETRIEVAL_MAX_PER_TEXT`.

---

## 7. Final summary & recommendation

**Established, shipped:**
- Golden coverage is complete (**69/69 works**); `golden-queries.test.ts` is the
  source of truth; `golden-retrieval.test.ts` is deprecated (PR #133, merged).
- walkGraph ranking on + deterministic; graph weight held at 0.3; dup-collapse
  and per-work cap both built, both **off by default** (PR #132).
- The blavatsky "regression" was diagnosed, not papered over: it is a crowder,
  its tags are semantically sound, and it passes its own gate.

**The residual 6 failures are proven to be vector-side, not fixable by output
capping:**
- 2 are cap-fixable only at an aggressive cap value (not worth the UX cost).
- 4 live in candidate generation / score calibration (fluent modern prose
  out-scoring archaic primaries; and, for isa-upanishad, the target never
  entering the candidate pool at all).

**Recommended path to go-live:**
1. Merge the cap as-is (OFF) — a correct, tested, measured tool at zero default
   cost.
2. Record the 6 as `knownGaps` with the §5 rank evidence (crowding / deep /
   recall bucket per work), so the gate is green and go-live is not blocked by
   works now proven to be a deeper problem.
3. Pursue **score calibration** as the real follow-up: length-normalise the
   vector similarity and/or dampen a work's score by its global hit-frequency
   (blavatsky matches everything → discount it), evaluated against this same
   frozen gate. This is the lever the measurement points at for the remaining 4.

**Open decisions for the owner:**
- whether to enable the cap (and at what value) vs. leave it off;
- whether to record the 6 as `knownGaps` now (unblocks go-live) or hold the gate
  red pending the score-calibration work;
- whether to wire `golden-queries.test.ts` into the corpus-load-to-VPS step as a
  hard blocker;
- `frozenEval` ratification on the 3 frozen works added in PR #133.

---

## 8. Follow-up: the retrieval-quality roadmap

PR #132 (walkGraph ranking + dup-collapse + per-work cap) and PR #133 (per-work
coverage + source-of-truth promotion) are **merged and deployed**. The go-live /
unblock steps (record the 6 as `knownGaps`, wire the gate into the corpus-load
step, fix the confounding corpus defects `49309aa1` / `6e0c2a63`) are the
mechanical part and are tracked on their own tickets. What follows is the actual
**retrieval-quality** work — the levers the measurement in §5–§6 points at for
the residual failures. Every item is a swept experiment, evaluated against the
frozen 320-probe gate, with **no regression below the current best (316/4)** as
the ship gate. A `knownGap` is promoted to an asserted gate the moment retrieval
surfaces it (`todo:31a7fe76`), so the gate ratchets forward and never rots.

### 8.1 Score calibration — highest leverage (NEW ticket)

The dominant force under 4 of the 6 failures is the **fluency inversion**: a
modern synthesis in clean prose out-embeds the archaic primary. The per-work cap
(§6) only *removes* a duplicate at emit time; calibration fixes the *score*, so a
buried primary can actually rise. Two independent, individually-testable
sub-experiments:

- **Length normalization** of the vector similarity term, so verbose modern
  prose stops winning on sheer token mass. Sweep the normalization strength
  against the gate.
- **Hub-frequency dampening** — discount a work's contribution by how often it
  matches *across unrelated queries* (blavatsky-sd matches nearly every
  cosmogony/death/alchemy query; §5 measured it holding 18–32 of the top scored
  slots). This is the principled, score-time version of the per-work cap.

Target failures: pistis-sophia (rank 19, pure scoring miss, no crowder) and the
deep-crowding pair (iamblichus, mabinogion). **Risk:** a scoring change touches
every query, so it *can* regress the 314 passing — the full gate is the
guardrail, not optional.

#### 8.1 — measured (todo:19ea34ea): both vector-score levers regress; reverted

Both sub-experiments were prototyped as env-gated knobs on the **vector
similarity term only** (leaving the graph/lexical rescue legs untouched), each
defaulting OFF, then run against the **FULL** 320-probe gate — not a spot check.

- **Length normalization** — BM25 pivoted on the corpus mean chunk token_count,
  `1/(1 - b + b·(tc/avg))`.
- **Hub-frequency dampening** — a per-text centrality score (distance to the
  corpus embedding centroid, normalized so central = 1), scaling similarity by
  `(1 - β·hub)`. Centroid proximity was the geometric proxy for "matches across
  unrelated queries."

**Baseline (re-established at true defaults, corpus v63): 314 / 6.** This is the
*cap-off* number — §9.2's "316/4" is the `RETRIEVAL_MAX_PER_TEXT=1` figure (§6),
not the shipped default, which leaves the cap off. The 6 asserted failures are
iamblichus, isa-upanishad, mabinogion, paracelsus-aurora, pistis-sophia,
poetic-edda-voluspo.

| config | gate | Δ vs 314/6 | what happened |
|---|---|---|---|
| defaults | **314 / 6** | — | baseline |
| length-norm b=0.5 | **301 / 19** | **−13** | recovered iamblichus (rank 48→5) but broke 13 previously-passing **short-text** probes (dhammapada, diamond-sutra, heart-sutra, pythagorean, gathas, corpus-hermeticum ×3, …) |
| hub-dampen β=0.15 | **306 / 14** | **−8** | dampened the **central primaries** it can't distinguish from the crowders (yoga-sutras ×3, tao-te-ching, plotinus, gospel-of-thomas — and iamblichus itself, rank 9/246) |

**Both regressed, for the same root reason: neither proxy actually measures what
the inversion is.** BM25 is *symmetric* — strong enough to lift a long crowded
target, it also boosts every short chunk corpus-wide and floods the aphoristic
traditions. Centrality conflates omnibus synthesizers with genuinely *broad*
primaries (iamblichus is centrality-rank 9/246; the Neoplatonic/Vedic material is
broad because it *is* broad), so it lowers targets as hard as crowders. **The
machinery was reverted, not shipped even off** — dead env knobs are net weight;
the value kept is this measurement (don't re-try these two shapes) and the
direction below.

**The real indicator is authorship era, and it is not in the vectors.** The
fluency inversion is specifically *modern synthesis* (Blavatsky 1888, the
Hall/Waite/Ouspensky compilations 1900s–1930s) out-embedding *archaic primaries*.
Era is **orthogonal to the semantic axis an embedding encodes** — a modern and an
ancient cosmogony passage are near-neighbours precisely because they share a
topic — so no vector-*score* transform can recover it, and both length and
centrality fail because verbosity and breadth are not era. The signal has to be an
**external, curated label**, and the corpus half-carries it already:

- **`tradition` is a clean proxy.** The modern-synthesis crowders live in exactly
  two traditions — **`theosophy`** (blavatsky-sd) and **`western_esoteric`**
  (secret-teachings, kybalion, tertium-organum, transcendental-magic, …) — while
  every casualty of the hub run is ancient (iamblichus/neoplatonism,
  yoga-sutras/hinduism, tao-te-ching/taoism, plotinus/platonism,
  gospel-of-thomas/gnosticism). A per-tradition modern-synthesis flag (those two,
  possibly `renaissance_hermeticism` at half weight) dampens the actual crowders
  and touches **none** of the targets — the exact conflation that sank hub-dampen
  disappears.
- There is **no composition-date column** (`works` has none; `work_dossiers`
  states the era only in prose `context`), so a finer per-work era would need a
  small curated addition to the corpus export (guru-repo owned), not a guru-web
  scoring hack. Start from the tradition flag; refine per-work only if the
  tradition granularity proves too coarse.

**Disposition: no calibration lever shipped.** The residual 4 (iamblichus, isa,
mabinogion, pistis) now point at (a) a curated modern-synthesis dampen keyed on
tradition/era, (b) §8.2 (fire the graph leg on paraphrase), and (c) §8.3
(candidate recall) — not at any transform of the vector score.

### 8.2 Concept-extraction upgrade (`todo:53480da1`)

`extractConcepts` is a Phase-1 LIKE match on concept labels; it goes **fully
dark** on paraphrased/abstract queries (measured: 0 concepts / 0 graph
candidates on 2/12 canonical queries). The graph leg is now correctly *ranked*
(§4), so making it *fire* on paraphrased narrative queries is the second lever —
move extraction to definition/synonym matching or embedding-based concept
selection. This is what lets the graph term rescue a rank-19 target the vector
leg alone can't lift.

### 8.3 Candidate-generation recall (`todo:31a7fe76`, and the isa-upanishad case)

Reranking cannot fix what was never fetched: **isa-upanishad's target never
entered the 202-candidate pool at all.** For that class:

- re-embed archaic / short-verse texts with a stronger model, or
- add a guaranteed lexical/entity recall leg, or
- query expansion at candidate time.

### 8.4 Thin-tradition safety (`todo:31a7fe76`)

`celtic` and `upanishads` are single-text traditions, so a work-miss is a
tradition-miss with no sibling to catch `mustIncludeTraditions`. Either a floor
guaranteeing one chunk per scoped tradition a query matches, or accept these as
permanent `knownGaps`. Decide explicitly rather than let them read as ranking
bugs.

### Sequencing

**8.1 first** — highest leverage, most measurable, and the lever the data most
directly implicates. Then **8.2** (unlocks the now-ranked graph leg on the
queries where the vector leg is weakest). **8.3 / 8.4** are the harder, narrower
residue — worth doing only after 8.1/8.2 show what they leave behind, since
calibration + a live graph leg may absorb several of the current failures on
their own.

---

## 9. Reproduce this — a cold-start guide (read before touching retrieval)

Everything in §5–§6 was measured; this section is how to re-measure it, so a new
agent can establish the baseline and evaluate a change without re-deriving the
harness. **Active ticket: `todo:19ea34ea` (score calibration, §8.1).**

### 9.1 Prerequisites (the gate is an integration test, not CI-run)

The golden gate exercises the real retriever against live infra, so it is gated
on `INTEGRATION_TEST` and skipped in CI. You need:

- **docker Postgres up with the corpus loaded** — container `guru-web-postgres-1`,
  reachable at the `.env` `DATABASE_URL` (`postgresql://guru:guru_dev@localhost:5432/guru`).
  `npm run dev:setup` (or `tsx scripts/dev-setup.ts`) loads
  `../guru/export/guru-corpus.sql.gz` if the corpus is missing/stale.
- **Ollama up with the embed model** — `OLLAMA_URL` (`http://localhost:11434`),
  model `nomic-embed-text` (the retriever embeds every query through it).

Sanity check both: `docker ps | grep postgres` and
`curl -s localhost:11434/api/tags | grep nomic`.

### 9.2 Run the gate / establish the baseline

```sh
export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs)
INTEGRATION_TEST=1 npx vitest run src/__tests__/golden-queries.test.ts   # ~14 min, all 69 works
```

Current best baseline at shipped defaults: **316 passed / 4 failed (320
recall-probes)** — the 4 are iamblichus / isa-upanishad / mabinogion /
pistis-sophia (§5). **No change may regress below this.** (It is a long run; drive
it via `agent-run start guru-web <task> -- bash -lc '...'` so it survives
disconnect, then `agent-run list` to poll.)

Iterate on a single work while authoring/debugging:
`npx tsx scripts/verify-golden-queries.ts <work>`. Validate fixture shape
CI-safely with `npx vitest run src/__tests__/golden-queries-schema.test.ts`.

### 9.3 Per-query debugging: `RETRIEVAL_TRACE`

`RETRIEVAL_TRACE=1` prints the full per-component score breakdown (vec / graph /
lex / diversity terms, plus any dup-collapse / per-work-cap skips) for the
emitted top-K of every `retrieve()` call. This is the first tool for "why did
this chunk rank here."

### 9.4 The measurement harness — `scripts/measure-retrieval.ts` (committed)

`retrieve()` truncates to topK and applies the caps, so it can't show you *where
a missing target actually scored*. `scripts/measure-retrieval.ts` reproduces the
**exact topK candidate pool** and prints the full, untruncated score order — the
tool behind the §5 rank table and the §6 cap simulation. It is committed, not
throwaway, so this measurement is reproducible without re-deriving it:

```sh
export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs)
npx tsx scripts/measure-retrieval.ts "<query>" --target <work> [--topk 15] [--cap N] [--show 20]
```

It reports the target's TRUE score-rank, which works crowd the slots above it,
the head in pure score order, and (with `--cap N`) whether a per-work cap of N
would lift the target into topK. The reproduction technique it wraps: faithful
pool (`vectorSearch topK*10`, `graph/lexical topK*2`) fed to
`mergeAndRerank(..., 99999, { perTraditionCap: 0 })` for the untruncated pure
score order.

**Trap the script encodes (do not work around it):** the intake pools scale with
topK, so `retrieve(q, 15)` and `retrieve(q, 120)` are *different computations*,
not a prefix relationship. A "rank" only means something relative to the pool
that produced it — always reproduce the topK pool (the script does), never read
a deeper `retrieve(q, 120)` as if it were the gate's list.

### 9.5 Env knobs (all default to production behaviour)

| env | effect | default |
|---|---|---|
| `RETRIEVAL_GRAPH_RANK` | `off` reverts walkGraph to the old unordered LIMIT | on |
| `RETRIEVAL_MAX_PER_TEXT` | per-work slot cap (number, or `off`) | `0` (off) |
| `RETRIEVAL_DUP_COLLAPSE` | `on` enables cosine dup-collapse | off |
| `RETRIEVAL_GRAPH_WEIGHT` / `RETRIEVAL_LEXICAL_WEIGHT` | leg weights (sweeps) | 0.3 / 1.0 |
| `RETRIEVAL_DIVERSITY` | `fixed` = pool-independent rarity | live |
| `RETRIEVAL_TRACE` | `1` prints the score breakdown | off |

A calibration change (§8.1) should add its own knob in the same style — default
to current behaviour, so `git`-reverting the default is a redeploy-free rollback.

### 9.6 What is NOT in a fresh clone

`scripts/golden-check.ts` (the deprecated staging canary of §1) and any
`*_probe.ts` files were local scratch, never committed. Do not depend on them;
`golden-queries.test.ts` is the source of truth and `scripts/measure-retrieval.ts`
(§9.4) is the committed measurement tool. Any further one-off probes are
throwaway — write them under `scripts/_*.ts` and delete after (they otherwise
break the whole-project `tsc` type-check).
