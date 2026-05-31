# Concept Hierarchy — guru-web Implementation Spec

_Status: design / not started. Author: design pass 2026-05-27._

_Implements the guru-web side of the **handoff contract** at
`../../../guru/docs/concept-hierarchy/guru-web-alignment.md` (the pipeline repo).
That doc is the source of truth for the data contract; this doc is how guru-web
consumes it. Read the handoff first — every "(handoff §N)" below points back to it._

---

## 1. TL;DR

The pipeline now exports a three-tier concept hierarchy (6 domains → 22 families →
95 concepts) plus two alias tables, at **corpus SCHEMA_VERSION 3**. Mirroring the
schema is necessary but **inert on its own**: typing `cosmology` still matches
nothing until `src/lib/graph.ts` learns to match families and domains.

The work splits into five phases, only the first two of which change retrieval
behaviour:

| Phase | What | Risk | Behaviour change |
|-------|------|------|------------------|
| 0 | Schema mirror + version lockstep | **deploy-blocking** | none (inert) |
| 1 | Three-namespace `extractConcepts` | medium | high-level queries start matching |
| 2 | Tier-weighted ranking (`match_tier`) | medium | graph-leg scores shift |
| 3 | API/DTO optional family fields | low | additive, back-compat |
| 4 | Family-aware browse/UX | low (greenfield) | new surfaces |

**Out of scope** (confirmed against the codebase, see §8): guru-review (separate
repo, not this codebase), alias-table population (pipeline-side), the new-concept
proposal loop, and removal of `concepts.domain`.

---

## 2. Current state in guru-web (grounding)

Verified against the tree on `main` as of this writing:

- **Schema mirror** — `schema/corpus-schema.sql` is at **v2** (119 lines). The
  pipeline's copy is at **v3** (161 lines). The only difference is additions (see
  §4.1 for the exact diff) — guru-web's file is a strict prefix of guru's.
- **Schema version is hard-coded `'2'` in three places**, not one:
  - `src/lib/boot.ts:45` — `export const EXPECTED_SCHEMA_VERSION = '2'` (the
    runtime gate; `checkCorpus()` throws `BootError` on mismatch, `boot.ts:115`).
  - `scripts/dev-setup.ts:23` — a **separate local copy** (`const
    EXPECTED_SCHEMA_VERSION = '2'`), not imported from `boot.ts`. Drives the
    auto-reload of the corpus dump before `npm run dev`.
  - `scripts/seed-dev.ts:18-71` — an **inline `CREATE TABLE … IF NOT EXISTS`
    schema** for the minimal local dataset. A third hand-maintained copy of the
    corpus shape; currently has no hierarchy tables.
- **Query plane** — `extractConcepts` (`src/lib/graph.ts:36`) is a single
  `LOWER(label) LIKE %word%` against `concepts` only. Returns `string[]`. The
  handoff's degradation symptom is real here: `cosmology`, `the One`, `salvation`
  all return `[]` and the retriever silently falls back to pure vector search.
- **`concepts.domain` is read nowhere.** Audit result (handoff §7 open question):
  the column is written only by `seed-dev.ts:162`; **no query in `src/lib/` or any
  route reads `concepts.domain` or `concepts.definition`.** So from guru-web's
  side, removing `domain` later is safe — nothing breaks. We keep it (export still
  emits it) but record that the audit is **clear**.
- **Two tier concepts already coexist** and must not be conflated (see §6):
  - *edge tier* — `verified`/`proposed`/`inferred` on `EXPRESSES` edges, read in
    `walkGraph` (`graph.ts:93`) and weighted in `retriever.ts:82`
    (`TIER_WEIGHTS = {verified:1.0, proposed:0.7, inferred:0.4}`).
  - *match tier* — `concept`/`family`/`domain`, the **new** dimension from query
    expansion (handoff §3.1–3.2). Does not exist yet.
- **`edges.weight`** is exported and seeded but **read by no query** — dead column
  today. Noted; not touched by this work.
- **No concept data leaves the app.** `/api/corpus` (`route.ts:20`) returns only
  `{ traditions: { [t]: { texts: [] } } }` aggregated from `chunks`; citations are
  chunk-centric (`types.ts:23` `Citation`). There is **no concept/family/domain
  DTO and no browse UI** — Phase 3/4 are greenfield.
- **guru-review is not in this repo.** No `review_tags`/`staged_tags`/`review`
  routes exist here. Handoff §3.5 is therefore **not actionable in guru-web**.
- **Tests that will move:** `src/__tests__/graph.test.ts` (asserts the exact
  `extractConcepts` LIKE params and `walkGraph` param alignment),
  `src/__tests__/boot.test.ts` (imports `EXPECTED_SCHEMA_VERSION`),
  `src/__tests__/rerank.test.ts`, `src/__tests__/retrieval.integration.test.ts`.

---

## 3. Goals / non-goals

**Goals**
1. Accept the v3 corpus without the app refusing to boot (lockstep, §5.2).
2. Make high-level queries (`cosmology`, `cosmic agents`, `the One`, `salvation`)
   retrieve, by matching across concept / family / domain namespaces.
3. Let `match_tier` shape ranking so a domain-level match is weaker than an exact
   concept match, without drowning the existing vector + edge-tier signals.
4. Carry family/domain context in concept-bearing responses so clients/UI don't
   re-query (optional fields, back-compat).
5. Give the corpus a browsable domain → family → concept structure now that
   families are real (22 of them, ~3–8 concepts each).

**Non-goals (this spec)**
- Populating alias tables (ships empty; pipeline-side, incremental — handoff §4).
- The new-concept proposal loop (handoff §3.6 — future).
- Any guru-review change (different codebase).
- Removing `concepts.domain` (deferred follow-on; audit is clear but the export
  still emits it, so removal is a separate coordinated change).
- Re-tagging chunks: **there are no v2 tags** — tagging stayed on the flat v1
  prompt (handoff §1, §4). Families attach to concepts, so every tagged chunk
  inherits family context for free. No chunk-level migration.

---

## 4. Phase 0 — Schema mirror + version lockstep (deploy-blocking)

### 4.1 Mirror `corpus-schema.sql` verbatim

The rule (handoff §1): the file must be **byte-identical across repos**. The diff
is purely additive — guru-web's v2 file is a strict prefix of guru's v3 file. The
additions are:

- A 3-line `v3` CHANGELOG entry in the header.
- A `concept hierarchy` block appended **after** `corpus_metadata`: four
  `CREATE TABLE`s (`concept_families`, `concept_family_membership`,
  `concept_aliases`, `family_aliases`), the `ALTER TABLE concepts ADD COLUMN
  family_id`, and two `COMMENT ON COLUMN` statements (`family_id`, `domain`).

**Do not hand-author these bytes.** Adopt guru's file wholesale so the hashes
match:

```
cp ~/Work/guru/schema/corpus-schema.sql ~/Work/guru-web/schema/corpus-schema.sql
```

Because the only differences are additions guru already has, the copy is the
byte-identical v3 contract. Verify before committing:

```
diff ~/Work/guru/schema/corpus-schema.sql ~/Work/guru-web/schema/corpus-schema.sql   # must be empty
```

Contract details worth internalising while reviewing (handoff §2):
- `concept_families`: domains have `parent_id IS NULL`; families point at their
  domain. IDs are dotted for families (`cosmology.cosmic_agents`), bare for
  domains (`cosmology`). `definition` is `NOT NULL`.
- `concept_family_membership.is_primary` is native **BOOLEAN** (`t`/`f`), not
  `0/1`. Exactly one primary per concept (a **partial unique index built
  post-load by the export**, not in this file — this file stays index-free).
- Both alias tables carry `CHECK(alias = LOWER(alias))` — the **Postgres CHECK is
  the strict Unicode-aware lowercasing authority** (SQLite's is ASCII-only); a bad
  row fails at COPY time, not silently.
- `concepts.family_id` is **export-maintained** from `WHERE is_primary`. The
  `COMMENT` says "do not edit at runtime" — honour it; no guru-web code writes it.

### 4.2 Bump the schema version in all three places

`EXPECTED_SCHEMA_VERSION` must advance to `'3'` **in the same deploy as the
export** or the app rejects the corpus (handoff §1, §5.2). Three touchpoints:

1. `src/lib/boot.ts:45` → `'3'`. This is the canonical gate.
2. `scripts/dev-setup.ts:23` → `'3'`. **Recommended: dedupe** by importing from
   boot instead of keeping a copy — `import { EXPECTED_SCHEMA_VERSION } from
   '../src/lib/boot'`. `boot.ts` has no import-time side effects (env is only read
   inside functions; `./db` is a lazy `await import`), so importing the constant
   into a script is safe. If dedupe is judged risky, at minimum cross-reference
   the two in comments so the next bump touches both.
3. `scripts/seed-dev.ts` inline `SCHEMA` (§4.3) — keep the dev shape
   representative.

`src/__tests__/boot.test.ts` imports `EXPECTED_SCHEMA_VERSION` and the
match/mismatch cases follow it automatically — no edit needed beyond confirming
the suite is green with `'3'`.

### 4.3 Keep `seed-dev.ts` representative

`scripts/seed-dev.ts:18` defines its own corpus DDL for the minimal local dataset
(it does **not** load the export). To keep local graph/UI work honest, add the
four hierarchy tables (and `concepts.family_id`) to the inline `SCHEMA`, and seed
a tiny tree over the existing four concepts — e.g. a `metaphysics` domain with a
`metaphysics.first_principles` family grouping `atman`/`nous`, and a
`soteriology` domain → `soteriology.liberation` family over `divine-spark`. Mark
one membership `is_primary = TRUE` per concept. Aliases can stay empty (they're
empty in prod too). This lets Phase 1/4 be exercised locally without the full
2GB export.

> Use BOOLEAN literals (`TRUE`/`FALSE`) for `is_primary` to mirror the Postgres
> contract, not `0/1`.

### 4.4 Apply path (no code, but the runbook)

- **Local dev:** `dev-setup.ts` already auto-reloads `../guru/export/
  guru-corpus.sql.gz` when `schema_version != EXPECTED` (`dev-setup.ts:67`). Once
  §4.2 bumps the constant and a fresh v3 dump is present, the next `npm run dev`
  reloads automatically.
- **VPS/staging:** the export `.sql.gz` is self-contained (staging schema → load →
  atomic swap), applied with `sudo -u postgres psql guru < export/
  guru-corpus.sql` — **no separate migration step** (handoff §5). The `postgres`
  user has no `DATABASE_URL`.
- **Sequencing against a live DB:** per the standing rule, freeze DB-touching ops
  while a pipeline fill is in progress; coordinate the apply for a quiet window.

---

## 5. Phase 1 — Query plane: three-namespace `extractConcepts`

This is the main work (handoff §3.1). Today `extractConcepts` matches only
`concepts.label`. Make it match tokens **simultaneously across three namespaces**
(not priority-ordered — a token can hit several), each emitting a `match_tier`:

1. **Concept** → `concepts.label` + `concept_aliases.alias` → `concept.<id>`,
   `match_tier = 'concept'`.
2. **Family** → `concept_families.label` + `family_aliases.alias` (rows where
   `parent_id IS NOT NULL`) → expands to **all** concepts with a
   `concept_family_membership` row for that family → `match_tier = 'family'`.
3. **Domain** → `concept_families.label` for domain rows (`parent_id IS NULL`) +
   their `family_aliases` → all concepts whose family's `parent_id` is that domain
   → `match_tier = 'domain'`.

Rules from the handoff that pin the design:
- **Substring `LIKE` on lowercased values everywhere**, not equality (same as
  today; preserve the existing `%`/`_` wildcard-stripping at `graph.ts:39`).
- **Read-side ignores `is_primary`** — primary and secondary memberships are
  co-equal for expansion. (`is_primary` only matters to the export-maintained
  denormalised `concepts.family_id` and to curation, neither of which is on the
  read path.)
- **`walkGraph` consumes the concept set unchanged** — its reachability /
  `EXPRESSES` logic is untouched. What changes is that each seed concept now
  carries a `match_tier`, which must be threaded through to ranking.
- **Aliases are inert today** (tables ship empty, handoff §4). The alias join
  paths must be *correct from day one* but will return zero rows until populated.
  **Do not block Phase 1 on alias data.**

### 5.1 Signature change

`extractConcepts` returns `string[]` today (`graph.ts:36`); `walkGraph` and
`graphSearch` (`retriever.ts:65`) consume that. Proposed:

```ts
export type MatchTier = 'concept' | 'family' | 'domain';
export interface ConceptMatch { conceptId: string; matchTier: MatchTier; }

export async function extractConcepts(queryText: string): Promise<ConceptMatch[]>;
```

A single token (`cosmology`) can yield the same `conceptId` at multiple tiers
(e.g. a concept literally named close to a family). **Dedupe by `conceptId`,
keeping the strongest tier** (`concept` > `family` > `domain`) so each concept
enters the walk once at its best match weight.

Implementation note: this is one query with three `UNION ALL` legs (or three
small queries merged in TS). A `UNION ALL` keeps it a single round-trip and lets
each leg tag its own `match_tier` as a literal column. The family/domain legs are
`concept_families`/`family_aliases` joined to `concept_family_membership`.

### 5.2 Threading `match_tier` to chunks

`walkGraph` expands seeds outward `HOP_DEPTH` (currently 1) concept→concept hops,
then collects chunks via `EXPRESSES`. To carry the match weight to ranking:

- Track a `matchWeight` per reachable concept in the `reachable` set (today a
  `Set<string>` at `graph.ts:72`; becomes a `Map<string, number>`). Seeds get
  their tier weight (§6). **Hop-discovered concepts inherit** the match weight of
  the frontier concept that reached them (a PARALLELS neighbour of a `concept`-tier
  seed is still a strong lead). This is the simplest defensible rule — flagged as a
  tunable in §10.
- A chunk reached via `EXPRESSES` from multiple reachable concepts takes the
  **max** matchWeight over them (consistent with the existing
  `Math.max(...graphScore)` merge at `retriever.ts:132`).
- Carry it out on the returned chunk. Add an optional field to the graph-leg
  chunk (see §7): `conceptMatchWeight?: number`.

> **Watch the candidate-set blowup.** Family/domain expansion can turn one token
> into all 3–8 concepts of a family (or every concept in a domain), and `walkGraph`
> then PARALLELS-hops each. With `HOP_DEPTH = 1` and 22 families this is bounded but
> materially larger than today's label-only seed set. Keep `HOP_DEPTH = 1` (the
> `graph.ts:23` comment ties any bump to the eval harness) and watch latency /
> candidate counts via `scripts/eval-retrieval.ts` (§9). If domain-tier expansion
> proves too broad, the lever is the §6 weight, not a structural cap.

`graphSearch` (`retriever.ts:65`) needs a trivial change: it currently early-returns
on `concepts.length === 0`; that stays, just over `ConceptMatch[]`.

---

## 6. Phase 2 — Ranking: `match_tier` as a weight

Handoff §3.2: `match_tier` → scalar weight, **concept 1.0 / family 0.5 / domain
0.25**, "multiplied into the existing chunk score." An alias match weighs the same
as the canonical label at its tier (`the One` == `monad`) — which falls out for
free since aliases resolve to the same `conceptId` at the same tier.

**Critical correctness point — two independent tiers.** The retriever already has
`TIER_WEIGHTS` for the *edge* tier (`verified/proposed/inferred`,
`retriever.ts:82`). The new match weight is a **separate** axis. Do not reuse the
`TIER_WEIGHTS` map or the `tier` field for it. Concretely, add:

```ts
const MATCH_TIER_WEIGHTS: Record<MatchTier, number> =
  { concept: 1.0, family: 0.5, domain: 0.25 };
```

**Reconcile "multiplied into" with the additive scorer.** `mergeAndRerank` is
deliberately **additive** (`retriever.ts:74-77`, a faithful port of the pipeline's
`_merge_and_rank`, replacing an earlier divergent multiplicative formula — see
`docs/retriever-hitlist.md` and `todo:fbf4652f`). Do **not** revert to a global
multiplicative score. Interpret "multiplied into" narrowly: **scale the graph-leg
term by the match weight**, leaving the additive combination and the vector leg
intact:

```
graphTerm = max(tierW, graphScore) * matchWeight     // matchWeight defaults 1.0
score     = VECTOR_WEIGHT * similarity + GRAPH_WEIGHT * graphTerm + diversity
```

- Vector-only chunks have no match weight → `matchWeight = 1.0` (no change to
  their score; they never came from query expansion).
- A chunk in both legs keeps its vector similarity untouched; only its graph
  contribution is scaled.
- This makes a domain-tier-only graph hit contribute ¼ of a concept-tier hit's
  graph term — the intended effect — without perturbing vector-driven ranking.

The `RETRIEVAL_TRACE` breakdown (`retriever.ts:163`) should gain a `matchW`
column so the trace stays the real scoring, not a re-derivation.

Weights `1.0 / 0.5 / 0.25` are a **starting point** (handoff §7). Treat them as
constants to tune against eval results, not settled values. "Multi-overlap
requirements" (a chunk matching several seeds) are explicitly a later tunable —
do not pre-build.

---

## 7. Phase 3 — API / DTO (optional, back-compat)

Handoff §3.4: endpoints returning concepts should consider carrying `family_id` /
`family_label` / `domain` so clients don't re-query, as **optional** fields.

Reality check against the code: **today no endpoint returns concepts.** `Citation`
(`types.ts:23`) and the retrieval path are chunk-centric; `/api/corpus` returns
traditions/texts. So Phase 3 is mostly about the *new* shapes Phase 4 needs, plus
the internal graph-leg field from §5.2:

- `src/lib/types.ts` — add (all new, additive):
  - `MatchTier`, `ConceptMatch` (from §5.1, exported for the graph/retriever
    boundary and tests).
  - An optional `conceptMatchWeight?: number` on the graph-leg chunk. Prefer a
    narrow internal type over widening the public `RetrievedChunk` if it leaks to
    clients; `RetrievedChunk` is already the merge currency, so a non-enumerable
    optional is acceptable — keep it optional so vector chunks and older callers
    are unaffected.
  - `Concept`, `Family`, `Domain` view types for Phase 4 (`{ id, label,
    definition }` + `family_id?`, `family_label?`, `domain?`).
- The repo uses **plain TS interfaces, no zod/OpenAPI** — keep new fields optional
  by convention; there is no schema validator to update.

No existing response shape changes. Older clients keep working.

---

## 8. Phase 4 — Family-aware browse / UX (greenfield)

Families are **real now** (clustering is done — 22 families of ~3–8 concepts), so
the earlier "mirror-state guard" caveat is **retired** (handoff §2, §3.3). There
is no existing browse UI to extend; this is net-new:

- **Browse domain → family → concept.** A new read-only navigation surface. Needs
  a new endpoint (e.g. `GET /api/concepts` or `/api/hierarchy`) returning the tree
  — built the same way `/api/corpus` is (aggregate from the real tables so the UI
  can't offer something the retriever can't deliver; **no hardcoded fallback** if
  empty — surface the empty state, per `api/corpus/route.ts` and the standing
  no-fallbacks rule).
- **Family context on concept/chunk views** — "Monad · Cosmology → Divine
  Structure" (the primary-family path via `concepts.family_id` → its `parent_id`).
- **Query-expansion transparency** — when `cosmology` expands to N concepts, show
  it. The `match_tier` from §5 is exactly the signal to render ("matched *Cosmology*
  → 7 concepts").

Per handoff §7, **do not hard-code anything per-concept** (two placements —
`emotional_epistemology`, `prophetic_rejection` — are flagged for a future
re-clustering pass; the UI must render whatever the tree says).

The browse UI is design-led; route it through the `frontend-design` skill when
built, consistent with the rest of the app.

---

## 9. Testing & regression gating

This change is unusually exposed to regression because it moves **two independent
variables in one effort** — the corpus data (v2 → v3) and the query-plane code
(Phase 1/2) — and the existing eval harness was built for changing only one. §9.1
explains why the obvious before/after is a trap; §9.2 is the gating plan that
isolates the variables; §9.3 is the golden set we keep afterwards as a standing
safety net; §9.4–9.6 are the tooling and unit coverage; §9.7 is where it can
actually run.

### 9.1 Why a single before/after won't work

`scripts/eval-retrieval.ts` was written for `todo:fbf4652f`: capture a baseline,
land the scorer, diff the aggregates. That assumed the corpus underneath was
fixed. Here it isn't — v3 may add concepts (the 7 ex-orphans) and adds the
family/membership/alias tables. So a naive "prod-today vs prod-after" diff bundles
the data change into the code change and **cannot attribute the delta**. Worse,
the new code *cannot run on the v2 corpus at all* (it queries `concept_families` /
alias tables that don't exist there), so there's no symmetric A/B unless we pin
the corpus. Treat it as a 2×2 with three real cells:

| | old code (label-only) | new code (3-namespace + match_tier) |
|---|---|---|
| **v2 corpus** | ① today's baseline | — *infeasible (new code needs v3 tables)* |
| **v3 corpus** | ② re-based baseline | ③ target |

- **① must be captured before the v3 export lands** — once staging is on v3, that
  cell is gone. Snapshot it as part of starting Phase 0, not as an afterthought.
- **① → ② is the regression gate on the schema bump itself.** Run the *unchanged*
  harness against v3 with the *old* query code; ② should ≈ ①. The handoff claims
  v3 is "inert on its own" (§2) — this makes that claim falsifiable. Divergence
  here means the export/data is wrong, caught *before* code muddies the signal.
- **② → ③ is the only honest query-plane verdict** (corpus held constant).
- **Avoid the ① → ③ diff** ("prod before vs prod after") — it's the conflated one.

Pin every knob identical across ② and ③: `HOP_DEPTH=1`, `topK=15`,
`scopeMode:'all'`, `MAX_PER_TRADITION=3`, same embedding model. The per-tradition
cap especially can mask or amplify expansion effects, so it must be constant or
you're back to two variables.

### 9.2 The breadth-masks-precision trap (the metric gap)

The current harness measures **breadth only** — distinct-tradition coverage,
graph-leg share of top-K, the `zeroConcept` counter. Three-namespace expansion
makes *every one of those go up* (more concepts matched → more graph hits → more
traditions, `zeroConcept` → ~0) **even if family/domain expansion is evicting
relevant vector hits from the top-K with loosely-related material**. Breadth is
exactly the wrong axis to gate a change whose risk is precision.

This is not hypothetical: the pipeline's `bench-v1-vs-v2.md` killed grouped-v2
tagging on an *agreement* regression (recall 71.7→50.4, precision 95.1→85.1) that
was only visible because they measured agreement against a trusted reference, not
aggregate shape. We adopt the same discipline: never accept "breadth went up" as
the verdict — gate ② → ③ on relevance (§9.3) with breadth as a sanity check, never
the reverse.

### 9.3 Golden retrieval tests (the durable deliverable)

A frozen golden set is the standing safety net — the thing that lets us make
*future* big changes (re-clustering, weight overhauls, a vector-model swap)
without holding our breath. Build it as part of this work even though it costs
labeling effort; it outlives this change.

- **Shape:** a checked-in fixture `src/__tests__/fixtures/golden-retrieval.json`
  (or similar) of `{ query, expect: { relevant_chunk_ids?: string[],
  must_include_traditions?: string[], must_include_texts?: string[] } }`. Start
  from the handoff §6 queries (`cosmology`, `the cosmos`, `cosmic agents`,
  `the One`, `salvation`) plus a handful of exact-concept queries that already
  work, so the set covers both the new high-level paths and the don't-regress
  baseline.
- **Pinned to a corpus snapshot.** The harness comment deliberately avoided a
  hardcoded expected-tradition list because it "would rot as the corpus grows" —
  that argument is about long-term *breadth tracking*. A golden set for
  *regression gating* is a different tool: it's pinned to a recorded corpus
  version (store `corpus_version` / `source_commit_sha` from `corpus_metadata`
  alongside the fixture) and re-baselined deliberately when the corpus changes,
  not expected to hold forever. Record which corpus snapshot the labels were cut
  against.
- **Metric:** precision@k / recall@k against the labels, plus a hard "must not
  drop below baseline" assertion per query. This is the number you tune the
  `1.0 / 0.5 / 0.25` match weights against (§6) — tune against agreement, sanity-
  check breadth doesn't collapse.
- **Labeling cost is the one real cost.** Cut labels semi-automatically: run cell
  ② to propose candidates per query, then have a human confirm/trim the relevant
  set (an LLM judge can pre-filter, human ratifies — same human-final-gate posture
  as the curation skills). Keep the set small and high-signal (~15–25 queries);
  this is a tripwire, not a corpus-wide eval.

### 9.4 Label-free top-K diff + score trace (cheap, do regardless)

Before/independent of labeling, the fastest read on a regression is a structural
diff:

- **Per-query top-K id diff** between ② and ③ — capture the ranked chunk-id list
  for each query in both cells and report what *entered* and what got *evicted*.
  No labels needed to spot "a strong vector hit got pushed out by three
  domain-tier-expanded chunks." Add this as an output mode of the harness (e.g.
  `EVAL_DUMP_TOPK=1` writes per-query id lists to compare across runs).
- **`RETRIEVAL_TRACE` (`retriever.ts:163`)** explains *why* a chunk ranked where
  it did. Extend the trace with a `matchW` column (already called for in §6) so a
  regressed query shows the 0.25 domain term that outranked a real vector hit.
  This turns "the diff looks worse" into a specific, fixable cause.

### 9.5 Harness changes (`scripts/eval-retrieval.ts`)

- Add the §6 high-level queries to `QUERIES` (`eval-retrieval.ts:40`).
- Add a **candidate-set-size** column (already prints `graphCand`) and a **per-
  query latency** column — these are the early-warning for the §5.2 family/domain
  expansion blowup. Watch `graphCand` jump from single digits toward the hundreds.
- Add a top-K-dump mode (§9.4) so two runs can be diffed mechanically rather than
  by eyeballing the table.
- Keep it **scoring/code-agnostic** so the *same* binary produces ①, ②, and ③ —
  the only thing that varies between runs is the checked-out code and the corpus
  it points at.

### 9.6 Unit-level regression (runs in CI, no DB)

- **`graph.test.ts`** — current tests assert the *exact* `extractConcepts` LIKE
  params (`['%100%', '%divine%', '%sparkbad%']`) and `walkGraph` param alignment
  (regression `todo:1d6a6709`, the `$1`/LIMIT collision). Both change shape:
  update the param assertions for the three-namespace UNION, and add cases for
  (a) a family token expanding to multiple concept IDs, (b) a domain token,
  (c) `match_tier` dedupe keeping the strongest tier, (d) alias paths returning
  zero rows gracefully (inert-but-correct).
- **`rerank.test.ts`** — add cases for `conceptMatchWeight` scaling the graph
  term: a domain-tier hit scores ¼ of an otherwise-identical concept-tier hit; a
  vector-only chunk (no match weight) is unchanged.
- **`boot.test.ts`** — green once `EXPECTED_SCHEMA_VERSION = '3'`; it follows the
  constant. Confirm.

### 9.7 Where each layer can actually run

- **CI** (`.github/workflows/ci.yml`) is lint + type-check + test on a runner with
  **no Postgres and no Ollama** — so only §9.6 unit tests run there. No schema-hash
  step exists either (see §11).
- **The eval harness and golden set need a live corpus *with real embeddings*** —
  so ②/③, the golden run, and the top-K diff are a **manual staging gate** run on
  the VPS staging DB (or local-with-real-corpus), executed by the operator at the
  phase boundaries in §12. Document it as a runbook step; don't pretend it's a
  green check on the PR. (Wiring it as a scheduled/remote job later is possible but
  not free — it needs DB + Ollama in the runner.)
- **Caveat — the integration "golden" tests run on zeroed embeddings.**
  `retrieval.integration.test.ts` seeds via `seed-dev`, which zeros every vector
  (`seed-dev.ts:150`), so its `"divine spark" → gnosticism` assertions validate
  **graph-walk plumbing, not vector relevance**. That's still useful: extend it
  with the high-level queries (`cosmology`, `the One`, `salvation`) as binary
  "does the graph leg fire now" tripwires — they return `[]` today and must return
  chunks after Phase 1. Just don't mistake them for the relevance gate; that's the
  §9.3 golden set on a real corpus.

---

## 10. Open questions / decisions to make

1. **Hop inheritance of `match_tier`** (§5.2): do hop-discovered concepts inherit
   the seed's match weight, decay it, or reset to a floor? Proposed: inherit (no
   decay) at `HOP_DEPTH = 1`. Revisit if domain-tier expansion + 1 hop proves
   noisy. This is the most behaviourally significant unresolved choice.
2. **Match weights `1.0 / 0.5 / 0.25`** — starting point only (handoff §7); tune
   against the §9.3 golden-set agreement metric (not breadth aggregates — §9.2).
3. **`conceptMatchWeight` on `RetrievedChunk` vs a graph-internal type** (§7) — pick
   based on whether the field risks leaking to API responses. Default: optional
   field, never serialised by existing routes.
4. **`scripts/dev-setup.ts` version constant** — dedupe via import from `boot.ts`
   (recommended) or keep a cross-referenced copy.
5. **`concepts.domain` removal** — deferred. Audit is clear (no reader in
   guru-web), but the export still emits it; removal is a separate coordinated
   schema change, not part of this work.

---

## 11. Risks / watch-items

- **Lockstep is unforgiving** (handoff §1, §5.2). The export raises if
  `corpus_metadata.schema_version != 3`, and `boot.ts:checkCorpus` throws if the
  app's `EXPECTED_SCHEMA_VERSION != 3`. They must move in the **same deploy**.
  Deploying the version bump before the v3 corpus is loaded → app refuses to boot;
  loading v3 before the bump → same. Stage both together.
- **No cross-repo schema-hash CI in guru-web.** The handoff §1 says "CI hashes both
  copies on every push (see that file's header)." guru-web's
  `.github/workflows/` has only `ci.yml` and `deploy.yml`, **neither hashes
  `corpus-schema.sql`**, and guru-web's file header doesn't mention the hash rule.
  So the byte-identical guarantee is currently enforced **guru-side only (or not at
  all on this side)**. Recommend adding a CI step here that fails if
  `schema/corpus-schema.sql` doesn't match the pipeline's published hash — or at
  minimum a documented manual `diff` gate in the deploy runbook. Flag to confirm
  where the hash check actually lives before relying on it.
- **Build with `next build --webpack`** (handoff §5). Already correct
  (`package.json` `"build": "next build --webpack"`) — Next 16 Turbopack silently
  ignores `middleware.ts` and standalone output is incompatible with `proxy.ts`.
  Don't "modernise" this to Turbopack. Clerk prod keys are domain-locked.
- **Candidate-set blowup** from family/domain expansion (§5.2) — bounded but real;
  watch the `graphCand` + latency columns added to the harness (§9.5).
- **Breadth-masks-precision** (§9.2) — the standing trap for this change: the
  current harness's breadth metrics will rise even on a precision regression. Gate
  on the golden set (§9.3), not on breadth.
- **Staging apply** is the remaining unknown (handoff §7): the v3 artifact is
  load-tested against `pgvector/pgvector:pg17` (clean load, validation passes,
  FK/BOOLEAN/partial-unique-index enforced). The open check is **real VPS Postgres
  apply** — version/extension parity, not artifact correctness.

---

## 12. Suggested sequencing

Mirrors handoff §6; pipeline side is fully unblocked. The §9 regression gates are
called out inline — they attach to the phase boundaries, not bolted on after.

0. **Capture baseline ① first** (§9.1): run `eval-retrieval.ts` against the current
   **v2** corpus and dump the per-query top-K (§9.4). Once staging moves to v3 this
   cell is unrecoverable, so it precedes everything.
1. **Phase 0** on a branch: `cp` the v3 schema (§4.1), bump the version in all
   three places (§4.2), update `seed-dev.ts` (§4.3). Confirm `boot.test.ts` green.
   *(main is protected — push the branch and open a PR; do not push to main.)*
2. Generate a real export, apply to **staging Postgres**, integration-test the
   load. **Gate ① → ②** (§9.1): run the *unchanged* harness on v3; assert ② ≈ ①.
   This proves the schema bump is inert before any query code lands; divergence
   here is a data/export problem, not a code one.
3. **Cut the golden set** (§9.3) against the v3 staging snapshot — propose
   candidates from cell ②, human-ratify. Record the corpus version it was cut
   against. (Can overlap step 4; needed before the step-5 verdict.)
4. **Phase 1 + 2**: three-namespace `extractConcepts` + tier-weighted ranking.
5. **Gate ② → ③** (§9.1–9.3): re-run the harness + golden set on the same v3
   staging corpus. Verdict = relevance must not regress (golden), breadth as
   sanity check, candidate-size/latency within bounds (§9.5). Tune the
   `1.0/0.5/0.25` weights against the golden metric here.
6. **Phase 4**: family-aware browse/UX (real families exist — no mirror guard).
7. **Phase 3 fields** land alongside whichever phase needs them (graph-leg field
   in Phase 1/2; view DTOs in Phase 4).
8. Alias population & proposal-loop UI: out of scope / future.
