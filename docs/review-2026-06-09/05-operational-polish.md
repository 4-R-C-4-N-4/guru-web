# 05 — Operational polish: quality filter default, diversity default, env surface

Three small items, grouped. Each is independent.

## A. Flip `RETRIEVAL_QUALITY_FILTER` default — after the upstream re-embed

### Problem

The quality filter (drop apparatus chunks, strip sacred-texts nav prefix and
`{p. N}` page markers) is opt-in:

```ts
// retriever.ts:47-51
if (process.env.RETRIEVAL_QUALITY_FILTER) {
  vectorResults = applyQualityFilter(vectorResults);
  ...
}
```

The nav prefix appears in ~32% of corpus bodies (retriever.ts:81 comment), so
by default users see boilerplate-polluted passages and apparatus chunks can
occupy top-K slots. The code comment is candid that the filter can't fix the
*ranking* (vectors were computed on polluted text; proper fix is upstream
re-embed, todo:b80d8d7d) — but the display/slot problem it does fix is on by
default for nobody.

### Design

Sequence with the pipeline item
(`guru/docs/review-2026-06-09/06-pipeline-ergonomics.md` §C):

1. Pipeline strips boilerplate in corpus + re-embeds changed chunks + exports.
2. This repo flips the filter to default-ON with `RETRIEVAL_QUALITY_FILTER=off`
   as the kill-switch (matching the `RETRIEVAL_LEXICAL` convention,
   retriever.ts:34). Post-re-embed it's a cheap permanent safety net, not a
   bridge doing load-bearing work.

If the upstream re-embed stalls, flip the default anyway — the measured
default-config principle stated at retriever.ts:24–27 ("the decided config
ships by default, no env required") argues the good behaviour shouldn't
require an env var either way.

### Acceptance

Eval harness (doc 04) run before/after; no golden query regresses; zero
apparatus chunks in any golden top-K; kill-switch restores old behaviour.

## B. Decide the default diversity mode

`RETRIEVAL_DIVERSITY=fixed` (pool-independent, log-scaled corpus rarity,
retriever.ts:106–120) was built because the default 'live' mode "couples
ranking to pool composition — so widening the pool churns the head"
(retriever.ts:53–57, tuning-experiment.md §4). The fix exists but the known-
flawed mode is still the default — the inverse of the repo's own
default-config principle. Either:

- measure 'fixed' on the harness and promote it to default
  (`RETRIEVAL_DIVERSITY=live` becomes the legacy escape hatch), or
- record why 'live' stays (e.g. fixed rarity misbehaves while tradition sizes
  are skewed 841-vs-15 and the corpus is still growing).

One eval run + a constant flip; the cache (`_rarity`) is already
deploy-static-safe. Note `corpusRarity` caches for the process lifetime — fine
while the corpus changes only at deploy, but it should be invalidated if doc
03's auto-reload ever loads a new corpus under a running server (currently
loads happen via dev-setup/deploy restarts, so this is a comment-level note).

## C. Document the env-flag surface

The retrieval path alone now has 8 tuning flags (`RETRIEVAL_POOL_MULT`,
`RETRIEVAL_LEXICAL`, `RETRIEVAL_LEXICAL_WEIGHT`, `RETRIEVAL_GRAPH_WEIGHT`,
`RETRIEVAL_DIVERSITY`, `RETRIEVAL_QUALITY_FILTER`, `RETRIEVAL_TRACE`,
`GRAPH_LEG`, plus `GRAPH_MATCH_MODE`), discoverable only by reading
`retriever.ts`/`graph.ts`. `.env.example` covers the required secrets but not
these. Risks: a sweep flag left set on prod silently diverges from the
documented default; a new operator can't tell tuned-default from override.

### Design

- Add a commented "retrieval tuning (optional — defaults are the measured
  config; leave unset in prod)" block to `.env.example` listing each flag, its
  default, and one line of meaning, with pointers to tuning-experiment.md.
- One-line guard at boot (`src/lib/boot.ts` already logs config): log any
  retrieval-tuning env vars that are set, so an accidentally-pinned override
  shows up in `journalctl` during incident triage.

### Acceptance

Every `process.env.RETRIEVAL_*`/`GRAPH_*` read in `src/lib/` has a
corresponding `.env.example` line; boot logs non-default overrides.
