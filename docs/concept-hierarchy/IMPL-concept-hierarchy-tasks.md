# Concept Hierarchy — Migration Task Breakdown (todo seed)

_Companion to the design spec `IMPL-concept-hierarchy.md`. This doc decomposes the
migration into discrete, ordered, **ticket-shaped** tasks — one parent + ordered
children — sized so each child is roughly one commit. It is the seed for the
`.todo/` store. Section references like "(§5.2)" point into the design spec._

## How to seed the todo list from this doc

Two equivalent paths:

- **Preferred:** run the `todo-plan` skill against this doc — it creates the parent
  ticket + ordered children and commits the structure, ready for `todo-implement`.
- **Manual:** the §"Seed commands" appendix has one single-line `todo new` per
  ticket. Create the parent first, then pass its id as `--parent` to the children.

Either way, **link the existing tickets** in the "Related tickets" section instead
of recreating them — three of them already cover slices of this work.

---

## Parent ticket

> **feature** — Concept-hierarchy alignment: consume pipeline v3 corpus
> (domains → families → concepts) end-to-end — schema lockstep, three-namespace
> query plane, tier-weighted ranking, golden-gated benchmark, family-aware UI.
> tags: `concept-hierarchy`, `epic`

---

## Ordered children

Ordering encodes dependencies. Gates (`GATE-*`) are checkpoints, not code — they
must pass before the next phase starts. `B0` is the one hard ordering constraint
that can't slip: baseline ① must be captured **before** staging moves to v3.

| # | Ticket summary | Type | Depends | Spec § |
|---|----------------|------|---------|--------|
| **T1** | `eval-retrieval.ts`: add high-level queries + `graphCand`/latency columns + `EVAL_DUMP_TOPK` per-query top-K dump; keep one code-agnostic binary for ①/②/③ | feature | — | §9.4–9.5 |
| **T2** | Capture retrieval **baseline ①** on the current **v2** corpus (aggregates + per-query top-K dump committed under `docs/concept-hierarchy/`) | chore | T1 | §9.1, §12.0 |
| **T3** | Mirror `schema/corpus-schema.sql` **v3 verbatim** from guru repo (`cp` + `diff` byte-identical verify) | chore | — | §4.1 |
| **T4** | Bump `EXPECTED_SCHEMA_VERSION` 2→3 in `boot.ts`; **dedupe** `dev-setup.ts`'s copy via import; confirm `boot.test` green | chore | — | §4.2 |
| **T5** | Extend `seed-dev.ts`: v3 hierarchy tables + `concepts.family_id` + a sample domain→family→concept tree (one `is_primary` per concept) | chore | T4 | §4.3 |
| **T6** | Generate v3 export, apply to **staging Postgres**, integration-test the load (real VPS PG parity) | chore (ops) | T3, T4 | §4.4, §12.2 |
| **GATE-A** | **Gate ①→②**: run the *unchanged* harness on v3 staging; assert ② ≈ ① (proves the schema bump is inert; divergence = data/export bug) | chore | T2, T6 | §9.1 |
| **T7** | `extractConcepts`: three-namespace match (concept / family / domain + alias tables) → `ConceptMatch[]`, dedupe to strongest tier; rewrite `graph.test` param assertions + add family/domain/dedupe/alias-zero cases | feature | T6 | §5.1 |
| **T8** | `walkGraph`: thread `match_tier` to chunks (reachable `Map`, hop inheritance, max `conceptMatchWeight`); cover hop-inherit + max-merge in `graph.test` | feature | T7 | §5.2 |
| **T9** | Ranking: add `MATCH_TIER_WEIGHTS`, scale the **graph term only** by match weight (additive scorer preserved); add `matchW` to `RETRIEVAL_TRACE`; `rerank.test` cases | feature | T8 | §6 |
| **T10** | Build **golden retrieval test set** — fixture pinned to the v3 snapshot (record `corpus_version`) + precision@k/recall@k scorer; ~15–25 queries, semi-auto-labeled from cell ②, human-ratified | feature | T6 | §9.3 |
| **T11** | `retrieval.integration.test.ts`: add high-level query tripwires (graph leg fires on `cosmology`/`the One`/`salvation`); note the zeroed-embedding caveat | chore (test) | T7 | §9.7 |
| **GATE-B** | **Gate ②→③**: run harness + golden set on v3 staging; tune `1.0/0.5/0.25` weights against golden agreement (breadth as sanity check only); confirm `graphCand`/latency bounded; record verdict | chore | T9, T10, T1 | §9.1–9.3, §12.5 |
| **T12** | Types: add `Concept`/`Family`/`Domain` view types + optional `family_id`/`family_label`/`domain` DTO fields (all additive, back-compat) | feature | — | §7 |
| **T13** | `GET /api/hierarchy`: domain→family→concept tree from the real tables (no hardcoded fallback — surface empty, per `/api/corpus`) | feature | T6, T12 | §8 |
| **T14** | Browse UI: domain→family→concept navigation surface (route through `frontend-design`) | feature | T13 | §8 |
| **T15** | Family context on concept/chunk views ("Monad · Cosmology → Divine Structure") from the `family_id` path | feature | T12, T13 | §8 |
| **T16** | Query-expansion transparency: surface "matched *Cosmology* → N concepts" using `match_tier` | feature | T9, T12 | §8 |
| **T17** *(recommended)* | CI guard: fail if `schema/corpus-schema.sql` diverges from the pipeline's published hash — or a documented manual `diff` gate in the deploy runbook | chore | T3 | §11 |

### Done-contract reminder (from `todo-implement`)

- Every ticket → a **linked commit** (`todo:<id>` prefix).
- **feature** → a test or a documented note. T7–T9, T13 carry concrete test work
  in their summaries; T12/T14–T16 are typed/UI and may close on a note + commit.
- **chore/ops** (T2, T6, GATE-A/B) → linked commit and/or the recorded artifact
  (baseline dump, staging-load log, gate verdict) as proof.
- main is protected → each ticket ships on a `todo/<id>` branch via PR (the user
  opens it); do not push to main.

---

## Critical path & parallelism

```
T1 → T2 ─────────────────────────────┐
T3 ─┐                                 │
T4 ─┼→ T6 → GATE-A → T7 → T8 → T9 → GATE-B → (T16)
T5 ─┘            └→ T10 ──────────────┘
                 └→ T11
T12 (anytime) → T13 → {T14, T15}
T17 after T3
```

- **T3/T4/T5** (schema mirror, version bump, seed-dev) are independent of each
  other and of T1/T2 — parallelizable.
- **T1 must precede T2**, and **T2 must precede T6** (baseline before the corpus
  moves). This is the only unforgiving order.
- **T10 (golden set)** can be cut in parallel with T7–T9 — labels are
  corpus-relative (cell ②), not code-relative — but must exist before GATE-B.
- **T12 (DTO types)** is additive and can land anytime; it unblocks the Phase-4 UI.
- **GATE-A and GATE-B are blocking** — no Phase-1 code before GATE-A passes; no
  Phase-4 polish declared "done" before GATE-B records the verdict.

---

## Related existing tickets (link, don't duplicate)

- **53480da1** (debt) — "extractConcepts Phase-1 LIKE match → 0 concepts on abstract
  queries, graph leg goes dark." **T7 resolves this.** Link T7 → 53480da1 and close
  it when T7 lands. (Caveat: the alias/synonym path it suggests ships *empty* in v1,
  so the resolution comes from family/domain expansion, not aliases yet — note that
  on close.)
- **6157e231** (feature) — "Phase C: vendor corpus-schema.sql, boot.ts validation."
  Earlier (v2) slice of the same schema/boot surface. **T3/T4 are its v3
  continuation** — link them; close 6157e231 if it was only ever about the initial
  vendoring.
- **9dedc4cb** (chore) — "Load full corpus via guru-corpus.sql.gz into **production**
  Postgres." This is the **prod** apply; **T6 is the staging** rehearsal. Sequence
  9dedc4cb after GATE-B + deploy, in lockstep with the version bump (§5.2).
- **9f401f76** (feature, eval-gated) — populate `edges.weight` + rank on a continuous
  edge score instead of 3 tier buckets. **Adjacent, not part of this migration** —
  it tunes the *edge* tier, a different axis from `match_tier` (§6). Leave open;
  GATE-B's harness output is exactly the eval that gates whether it's worth doing.
- **77aa7477** (chore) — manual HNSW index. Likely **superseded**: indexes are now
  created post-load by the export, and the handoff (§2) says guru-web doesn't manage
  them. Confirm, then close as obsolete or re-scope to "verify export built them."

---

## Deferred / explicitly not ticketed now

Per design spec §3 non-goals and §10:

- **Alias-table population** — pipeline-side, incremental; query paths land inert
  (T7) and improve silently. No guru-web ticket.
- **New-concept proposal loop** (§3.6) — future; family-first review UI, separate
  focused LLM call. Out of scope.
- **`concepts.domain` removal** (§10.5) — deferred follow-on; audit is clear (no
  guru-web reader) but the export still emits it. Separate coordinated change.
- **guru-review changes** (§3.5) — different codebase; not actionable here.

---

## Seed commands (manual path)

Create the parent, then substitute its printed id for `$P` in the children. One
single-line command per ticket.

```bash
todo new -t feature --tags concept-hierarchy,epic "Concept-hierarchy alignment: consume pipeline v3 corpus (domains→families→concepts) — schema lockstep, three-namespace query plane, tier-weighted ranking, golden-gated benchmark, family-aware UI"
# export P=<printed-parent-id>
todo new --parent $P -t feature --tags benchmark -f scripts/eval-retrieval.ts "eval-retrieval.ts: add high-level queries, graphCand+latency columns, EVAL_DUMP_TOPK top-K dump; keep one code-agnostic binary for cells 1/2/3"
todo new --parent $P -t chore --tags benchmark "Capture retrieval baseline (cell 1) on v2 corpus: aggregates + per-query top-K dump committed before v3 export lands"
todo new --parent $P -t chore --tags schema,lockstep -f schema/corpus-schema.sql "Mirror corpus-schema.sql v3 verbatim from guru repo (cp + diff byte-identical verify)"
todo new --parent $P -t chore --tags schema,lockstep -f src/lib/boot.ts "Bump EXPECTED_SCHEMA_VERSION 2->3 in boot.ts; dedupe dev-setup.ts copy via import; confirm boot.test green"
todo new --parent $P -t chore --tags schema,dx -f scripts/seed-dev.ts "Extend seed-dev.ts: v3 hierarchy tables + concepts.family_id + sample domain->family->concept tree (one is_primary per concept)"
todo new --parent $P -t chore --tags ops,staging "Generate v3 export, apply to staging Postgres, integration-test the load (real VPS PG parity)"
todo new --parent $P -t chore --tags benchmark,gate "GATE A (cell 1->2): run unchanged harness on v3 staging, assert approx equal to baseline (schema-inert proof)"
todo new --parent $P -t feature --tags query-plane,retrieval -f src/lib/graph.ts "extractConcepts: three-namespace match (concept/family/domain + alias) to ConceptMatch[], dedupe strongest tier; rewrite graph.test param assertions + family/domain/dedupe/alias-zero cases"
todo new --parent $P -t feature --tags query-plane,retrieval -f src/lib/graph.ts "walkGraph: thread match_tier to chunks (reachable Map, hop inheritance, max conceptMatchWeight); cover hop-inherit + max-merge in graph.test"
todo new --parent $P -t feature --tags ranking,retrieval -f src/lib/retriever.ts "Ranking: MATCH_TIER_WEIGHTS scale graph term only (preserve additive scorer); add matchW to RETRIEVAL_TRACE; rerank.test cases"
todo new --parent $P -t feature --tags golden-tests,benchmark "Build golden retrieval test set: fixture pinned to v3 snapshot (record corpus_version) + precision/recall scorer; ~15-25 queries, semi-auto-labeled from cell 2, human-ratified"
todo new --parent $P -t chore --tags test,retrieval -f src/__tests__/retrieval.integration.test.ts "retrieval.integration.test: add high-level query tripwires (graph leg fires on cosmology/the One/salvation); note zeroed-embedding caveat"
todo new --parent $P -t chore --tags benchmark,gate "GATE B (cell 2->3): run harness + golden set on v3 staging, tune match weights against golden agreement, confirm graphCand/latency bounded, record verdict"
todo new --parent $P -t feature --tags api,types -f src/lib/types.ts "Types: Concept/Family/Domain view types + optional family_id/family_label/domain DTO fields (additive, back-compat)"
todo new --parent $P -t feature --tags api,ui "GET /api/hierarchy: domain->family->concept tree from real tables (no fallback, surface empty)"
todo new --parent $P -t feature --tags ui "Browse UI: domain->family->concept navigation surface (frontend-design)"
todo new --parent $P -t feature --tags ui "Family context on concept/chunk views (Monad · Cosmology -> Divine Structure) from family_id path"
todo new --parent $P -t feature --tags ui "Query-expansion transparency: surface matched family/domain -> N concepts using match_tier"
todo new --parent $P -t chore --tags ci,schema -f .github/workflows/ci.yml "CI guard: fail if corpus-schema.sql diverges from pipeline published hash, or documented diff gate in deploy runbook"
```
