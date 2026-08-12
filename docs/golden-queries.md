# Per-work golden queries: the corpus ritual

**What:** every work in the corpus gets a query file at
`src/__tests__/fixtures/golden-queries/<work>.json` (`<work>` = a `corpus.works`
id), drafted from the work's chunks and owner-ratified in PR review. The files
grow the golden retrieval eval past the frozen 14-query
`golden-retrieval.json` gate, which stays as-is, corpus-version-pinned.

**Why by ritual:** queries that arrive with each corpus update cannot be
cherry-picked toward any particular retrieval approach, and the set extends
judgment power past the original 11 positives while feeding the fine-tune
query distribution (scorer ladder rung 3 is gated on the train/eval
partition below). Design record: rellm `docs/edges/query-scorer-rungs.md` +
edge-roadmap 2026-08-12 addenda.

## Two query kinds — kept separate

**Recall probes** re-ask a chunk's content in a reader's own words and assert
only that the work's tradition (and optionally the work itself,
`mustIncludeWork`) survives into top-K — exactly the bar of the existing
tradition-anchored goldens. Never chunk-level: the chunk a probe was drafted
from is recorded, not asserted.

**Relevance queries** are conceptual questions the work answers that other
traditions also answer. They assert **nothing** — the schema rejects any
assertion key on them. The integration gate runs them and exports
`src/__tests__/output/relevance-manifest.json` (gitignored); grading happens
post-hoc under the (query, chunk) judgment frame (kappa +0.800), outside this
repo.

Do not blur the kinds. A recall probe with no defensible target belongs as a
relevance query; a relevance query you feel sure about is still not a probe
until a human would assert its tradition from comparative-religion knowledge
alone.

## Authoring rules

1. **Paraphrase against circularity.** Copied distinctive words make FTS hits
   self-fulfilling: the lexical leg will trivially refind the chunk you
   copied from. Rewrite the chunk's distinctive vocabulary into your own
   words ("fletcher/arrow" → "craftsman straightening a shaft").
   *Reader-honest anchors are allowed*: proper nouns and titles any reader of
   the work knows (Taliesin, Owain, "thirst" as a chapter name) are fair —
   the rule bans lifting the chunk's phrasing, not knowing what the work is
   about.
2. **Provenance on every query.** `provenanceChunkIds` records the chunk(s)
   the query was drafted from — audit trail only, never asserted, never
   graded as ground truth.
3. **Verify before you ship.** Run the integration gate (below). A probe that
   misses top-K gets *honestly iterated*: strengthen the reader-honest
   anchors, note the failed draft in the query's `note`, and never paste
   chunk phrasing to force a pass. If no honest wording survives, the work
   has a real recall gap — file it as a todo and leave the probe out (cf.
   the `knownGaps` pattern in `golden-retrieval.json`).
4. **Work-disjoint train/eval partition, from day one.** `frozenEval: true`
   marks the whole work's file as part of the frozen eval subset;
   `frozenEval: false` makes its queries eligible for the fine-tune query
   distribution. The flag is per work, required, and **one-way**: a work
   whose queries have fed training can never move into the frozen subset.
   Keep roughly a third of works frozen, chosen for tradition spread.
5. **Strict schema.** Unknown keys are validation errors (typo'd assertion
   keys must fail loudly). Shape is enforced in CI by
   `golden-queries-schema.test.ts`; see
   `fixtures/golden-queries/_example.json` for a commented reference and
   `src/__tests__/helpers/golden-queries.ts` for the validator.

## Draft-then-ratify flow

1. Draft the file from the work's chunks (read them; don't write queries from
   memory of the work).
2. Verify locally. While iterating on one work, the author-side verifier
   checks just that file against live retrieval:

   ```sh
   npx tsx scripts/verify-golden-queries.ts <work> [<work>...]
   ```

   Before the PR, run the real gates:

   ```sh
   npx vitest run src/__tests__/golden-queries-schema.test.ts   # shape, CI-safe
   export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs)
   INTEGRATION_TEST=1 npx vitest run src/__tests__/golden-queries.test.ts
   ```

3. Open the PR. The owner ratifies query wording, kind choices, and the
   `frozenEval` flag in review — drafts are proposals until then.

## Corpus-update hook

A corpus update that adds or re-chunks a work ships that work's query file
(new or re-audited) **in the same PR** — this is what makes the eval grow by
ritual instead of by sprint:

- new work → new `<work>.json`, drafted from its chunks;
- re-chunked work → re-verify its probes (chunk ids in `provenanceChunkIds`
  may have moved — update them), bump the file's `corpus_version`;
- unrelated works are untouched; their stale `corpus_version` only warns in
  the integration gate, never fails.

`corpus_version` in a file therefore means "last drafted/audited against",
not "valid only at".
