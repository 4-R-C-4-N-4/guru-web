# 02 — Semantic concept matching (query-time half)

Pipeline-side half: `guru/docs/review-2026-06-09/05-semantic-concept-matching.md`
(concept-definition embeddings exported into the corpus schema; schema_version
3 → 4). This doc covers what changes in this repo once those vectors exist.

## Problem statement

`extractConcepts` (graph.ts:104–170) is the sole entry point to the graph leg,
and it only fires on **lexical** matches: tokenised word-boundary regex (or
LIKE) against concept/family/domain labels and aliases. The machinery built on
top — match tiers, expansion weights, the transparency chip — is good; the
entry point caps its recall:

- Paraphrases miss: "becoming like God" never reaches `theosis_deification`;
  "negative theology" reaches `apophatic_theology` only if an alias row says so.
- Alias coverage is 50 concept aliases / 0 family aliases (staging DB,
  2026-06-09) and is hand-curated by construction — the long tail never closes.
- The matcher needs a 48-word stopword list (graph.ts:59–66) and a
  regex-vs-LIKE mode flag to fight tokenisation artifacts that embeddings
  don't have.

The query is **already embedded** on every request for the vector leg
(retriever.ts:131), so semantic concept matching costs one ~100-row pgvector
scan — effectively free.

## Design

### Plumbing

`embed()` currently happens inside `vectorSearch`. Lift it so the query vector
is computed once in `retrieve()` and passed to both legs:

```ts
// retriever.ts retrieve() — before the Promise.all
const queryEmbedding = await embed(queryText);
let [vectorResults, graphResults, lexicalResults] = await Promise.all([
  vectorSearch(queryEmbedding, prefs, topK * poolMult),
  graphSearch(queryText, queryEmbedding, prefs, topK * 2),
  ...
]);
```

(Also removes a latent double-embed if anything else ever needs the vector.)

### New matching leg inside `extractConcepts`

```ts
// graph.ts — alongside the existing lexical UNION query
const semanticRows = await query<{ concept_id: string; sim: number }>(
  `SELECT id AS concept_id, 1 - (embedding <=> $1::vector) AS sim
   FROM concepts
   WHERE embedding IS NOT NULL
   ORDER BY embedding <=> $1::vector
   LIMIT $2`,
  [JSON.stringify(queryEmbedding), SEMANTIC_MATCH_LIMIT]   // limit ~5
);
const matches = semanticRows.filter(r => r.sim >= SEMANTIC_MATCH_THRESHOLD);  // ~0.6, sweep it
```

Merge into the existing strongest-tier dedupe with a weight that reflects
match confidence rather than a fixed tier:

- Exact label/alias hit (existing legs): `MATCH_TIER_WEIGHTS.concept = 1.0` —
  unchanged; lexical anchors stay strongest.
- Semantic hit: weight `min(1.0, sim)` scaled into the same range as the
  existing tiers — e.g. map `[threshold, 1.0] → [MATCH_TIER_WEIGHTS.family,
  MATCH_TIER_WEIGHTS.concept]` so a borderline semantic match counts like a
  family expansion (0.5) and a near-exact one like a direct concept match.
  This drops straight into the existing `conceptMatchWeight` plumbing
  (graph.ts:247–251, retriever.ts:354) with **zero scoring-formula changes**.

### Transparency

`summarizeExpansion` (graph.ts:181) should report semantic expansions the same
way family/domain fan-outs are reported — the chip is the user-facing proof
the graph leg fired, and semantic matches are precisely the non-obvious ones
worth showing (`matched "becoming like God" → Theosis (0.71)`).

### Flags & rollout

- `GRAPH_SEMANTIC=off` kill-switch, mirroring `RETRIEVAL_LEXICAL` /
  `GRAPH_LEG` conventions (retriever.ts:34, 160).
- Threshold and limit as optional env overrides for sweeping without redeploy,
  defaults hardcoded once measured — same pattern as
  `RETRIEVAL_LEXICAL_WEIGHT` (retriever.ts:62–64).
- Gate the default-on flip on the golden-set eval (doc 04): expected wins on
  paraphrase queries; required non-regression on entity queries and on
  latency (one extra ~100-row scan; budget ≤ 2ms).

## Dependencies

- Pipeline export of concept embeddings (schema_version 4) — blocked on
  `guru/docs/review-2026-06-09/05-semantic-concept-matching.md`.
- `EXPECTED_SCHEMA_VERSION` bump in `src/lib/boot.ts` in lockstep.
- Doc 04's harness for the threshold sweep.

## Acceptance criteria

- "becoming like God", "negative theology", "the unmanifest absolute" trigger
  graph expansion with visible chips, without alias rows for those phrasings.
- p@10 on the golden paraphrase class improves; entity class unchanged.
- `GRAPH_SEMANTIC=off` restores byte-identical current behaviour.
- Stopword list and regex/LIKE modes untouched (lexical leg unchanged).
