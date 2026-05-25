# Retriever bug hitlist — `guru-web`

Four bugs in the hybrid retrieval scoring path. Ordered by impact. Each is independently verifiable and fixable. Together they suppress the graph leg's contribution and silently downweight all vector results, which means scoring changes can't be cleanly evaluated until these are resolved.

Files: `src/lib/retriever.ts`, `src/lib/graph.ts`

---

## Bug 1: Vector results have no `tier` field, get silently downweighted to 0.4

**File:** `src/lib/retriever.ts`
**Lines:** 42–51 (vector SELECT), 95–98 (scoring)

The vector SELECT does not include `tier`:

```ts
// retriever.ts:42-51
const rows = await query<RetrievedChunk & { distance: number }>(
  `SELECT id, text_id, tradition, text_name, section, translator, body, token_count,
          (embedding <=> $1::vector) AS distance,
          'vector' AS source
   FROM chunks
   WHERE ${where}
   ORDER BY embedding <=> $1::vector
   LIMIT $${paramIndex}`,
  [JSON.stringify(queryEmbedding), ...params, limit]
);
```

The scoring reads `chunk.tier` with no `undefined` branch:

```ts
// retriever.ts:95-98
const tierWeight =
  chunk.tier === 'verified' ? 1.0
  : chunk.tier === 'proposed' ? 0.7
  : 0.4;
```

**Why TypeScript doesn't catch it:** `RetrievedChunk.tier` is declared optional in `src/lib/types.ts:20` (`tier?: 'verified' | 'proposed' | 'inferred'`).

**Impact:** Every vector-only result (i.e. anything not also returned by the graph leg) falls through both ternaries to the final `0.4` branch. The vector leg's tier signal is destroyed; a `verified` chunk that vector search ranked #1 is scored the same as an `inferred` one. Since most results come from vector search, this affects most of the merged list.

**VERIFIED (2026-05-25):** `tier` does **not** exist on the `chunks` table. `schema/corpus-schema.sql:76-87` defines `chunks` with no `tier` column; `tier` exists only on the `edges` table (`schema/corpus-schema.sql:104`, "tier encodes confidence verified/proposed/inferred"). The `migrations/` dir (001–012) is entirely app-side and never touches the corpus, and `corpus-schema.sql` is the byte-identical cross-repo contract — so this is definitive.

Consequence: the "add `tier` to the vector SELECT" fix below is **invalid** — it would throw `column "tier" does not exist`. tier is intrinsically a property of *how a chunk was reached through the graph* (via the EXPRESSES edge it came in on — see `graph.ts:90`, which reads tier off `expressEdges`), not an intrinsic property of a chunk. A vector hit has no originating edge, so it has no natural tier. This is the redesign case, not the one-liner case.

**Agent task (revised after verification):**
1. ~~Confirm `chunks.tier` exists~~ — done: it does not. Do **not** add `tier` to the vector SELECT.
2. Treat this as a scoring redesign, not a column fix. The tier-weight multiplier cannot apply to vector results because they carry no tier. Decide how the vector and graph legs should be weighted when only one of them has a tier signal. (This overlaps heavily with Bug 2 — see the RRF option there, which removes the per-chunk tier multiplier from the unified list entirely and treats tier as a separate, optional re-rank signal only where it exists.)
3. Until the redesign lands, at minimum change the scoring fallback from a silent ternary default to an explicit `chunk.tier === undefined ? <decision> : ...` branch so the "no tier" case is deliberate and visible rather than silently collapsing to `0.4`.

---

## Bug 2: Graph results get a flat 0.5 distance fallback, structurally lose to vector

**File:** `src/lib/retriever.ts`
**Line:** 101

```ts
// retriever.ts:101
const distanceScore = chunk.distance != null ? 1 - chunk.distance : 0.5;
```

**Impact:** Graph results have no `distance` and get the `0.5` fallback. Vector results have real cosine distances, typically 0.2–0.4 for good matches, giving `distanceScore` of 0.6–0.8.

A graph-only result is therefore capped at `0.5 × tierWeight × diversityBoost`, while a strong vector hit gets `0.7+ × tierWeight × diversityBoost`. The graph leg is structurally penalized relative to vector — the opposite of what the comparative-religion use case wants. The whole point of the graph leg is to surface cross-tradition parallels that vector search misses; the current scoring guarantees those parallels rarely make it into the top-K.

**VERIFIED (2026-05-25):** `walkGraph` (`graph.ts:78-91`) selects no distance and returns chunks carrying only `source` and `tier`, so `chunk.distance` is `null` for every graph result and the `0.5` fallback always fires. Confirmed.

**Agent task:**
1. ~~Read `walkGraph` to confirm graph results have no distance-equivalent score~~ — confirmed above.
2. Choose one of two fixes and propose both with tradeoffs:
   - **(a) Calibrated edge-type fallback:** Replace the flat `0.5` with a per-edge-type score (e.g. `EXPRESSES` = 0.75, `PARALLELS` = 0.7, `DERIVES_FROM` = 0.65). Requires plumbing the originating edge type through `walkGraph` into `RetrievedChunk`.
   - **(b) Reciprocal Rank Fusion (RRF):** Replace the multiplicative score entirely. Rank each leg independently, then score each chunk as `Σ 1/(k + rank_i)` across legs. Normalizes the two scales without needing a calibrated distance for graph results. Standard hybrid-retrieval approach, easier to reason about.
3. Do not implement until I confirm which direction.

---

## Bug 3: Diversity boost is order-dependent — "first-seen wins," not "rarest wins"

**File:** `src/lib/retriever.ts`
**Lines:** 88–104

```ts
// retriever.ts:88-104
const traditionCounts = new Map<string, number>();

const scored = merged.map(chunk => {
  const count = (traditionCounts.get(chunk.tradition) ?? 0) + 1;
  traditionCounts.set(chunk.tradition, count);

  const tierWeight =
    chunk.tier === 'verified' ? 1.0
    : chunk.tier === 'proposed' ? 0.7
    : 0.4;

  const diversityBoost = count === 1 ? 1.3 : 1.0;
  const distanceScore = chunk.distance != null ? 1 - chunk.distance : 0.5;

  return { chunk, score: distanceScore * tierWeight * diversityBoost };
});
```

**Impact:** `traditionCounts` is built during the same `.map` that consumes it. The *first chunk of each tradition* to appear in `merged` gets the `1.3` boost; every subsequent chunk in that tradition gets `1.0`. Since `merged` is dedup-ordered (vector first via the `seen` map at lines 80–83, then graph), the boost goes to whichever chunk happens to surface first within its tradition.

**Correction to original framing (2026-05-25):** the boost is *not* "one tradition wins" — every tradition's first-appearing chunk gets the `1.3`. The real defect is subtler: a binary "first-per-tradition" boost rewards the lone representative of an *over*represented tradition exactly as much as the representative of a rare one, and rewards them by position rather than by rarity. So it doesn't actually implement "rare tradition wins."

Concrete failure: a query that vector-matches six Plotinus chunks before any Vedanta chunk shows up → Plotinus's first chunk gets the `1.3`, its five siblings get `1.0`, and the rarer Vedanta chunk also gets `1.3`. The single over-represented Plotinus chunk and the scarce Vedanta chunk end up boosted identically — rarity is never actually rewarded, which is the opposite of what the "tradition diversity" comment at `retriever.ts:88` implies.

**Agent task:**
1. Restructure into two passes: first pass counts traditions across all merged chunks, second pass scores using the totals so "rare tradition" gets the boost instead of "first-seen tradition."
2. Consider whether the boost should be continuous (`1 + 1/count`) rather than binary (`1.3` vs `1.0`). A binary boost still over-rewards the single representative of an overrepresented tradition. Continuous is smoother and behaves better as the corpus grows.
3. Add a unit test in `src/__tests__/` that pins down the desired behavior: given a merged list with [Plotinus×6, Vedanta×1, Sufi×1], the Vedanta and Sufi chunks should outscore the Plotinus chunks at equal distance/tier.

---

## Bug 4: Graph walk claims "1–2 hops" but only does 1

**File:** `src/lib/graph.ts`
**Lines:** 36–68

The docstring at line 38 says:

```ts
// graph.ts:38
 * Fetches chunks that EXPRESSES any concept reachable within 1–2 hops.
```

But the implementation only walks one hop before the EXPRESSES lookup:

```ts
// graph.ts:48-68
// Collect concept IDs reachable within 1 hop (direct neighbours)
const neighbourRows = await query<{ source: string; target: string; tier: string }>(
  `SELECT source, target, tier FROM edges
   WHERE (source = ANY($1::text[]) OR target = ANY($1::text[]))
     AND edge_type IN ('PARALLELS', 'DERIVES_FROM', 'EXPRESSES')`,
  [conceptIds]
);

const reachable = new Set<string>(conceptIds);
for (const r of neighbourRows) {
  reachable.add(r.source);
  reachable.add(r.target);
}

// Find chunks that EXPRESSES any reachable concept
const expressEdges = await query<{ source: string; tier: string }>(
  `SELECT source, tier FROM edges
   WHERE target = ANY($1::text[])
     AND edge_type = 'EXPRESSES'`,
  [Array.from(reachable)]
);
```

That's `extractedConcepts → 1 hop of PARALLELS/DERIVES_FROM/EXPRESSES neighbours → chunks via EXPRESSES`. One conceptual hop, not two. To match the docstring there'd need to be a second neighbour-expansion query before the EXPRESSES lookup.

Also worth flagging: `EXPRESSES` is in both edge_type lists. In the first query it expands the reachable concept set via EXPRESSES edges (which connect chunks to concepts, not concepts to concepts). That's likely a mistake — an EXPRESSES edge from chunk→concept being treated as a concept-graph edge means chunks get added to `reachable`, and then the second query looks for `EXPRESSES` edges whose `target = chunk_id`, which will never match because EXPRESSES targets are concepts, not chunks. Net effect: the EXPRESSES inclusion in the first query is probably a no-op but it's polluting `reachable` with chunk IDs unnecessarily.

**VERIFIED (2026-05-25):** Both observations confirmed against `graph.ts:48-68`. Only one concept-to-concept expansion happens before the EXPRESSES chunk lookup, so the walk is one conceptual hop, not the 1–2 the docstring claims. And the EXPRESSES-in-first-query line does pull chunk IDs into `reachable` that can never match the second query's concept-typed `target`. One nuance to add: removing EXPRESSES from the first query is **safe with no retrieval loss** — chunks expressing the *seed* concepts are still found, because the seed `conceptIds` are seeded into `reachable` directly at `graph.ts:56` and the second query matches them. So the first-query EXPRESSES inclusion is pure pollution, not a load-bearing path.

**Agent task:**
1. Decide: is the 1-hop behavior intentional (latency budget) or is the missing second hop a real bug?
   - If intentional: fix the docstring to say "1 hop" and document the latency reason.
   - If a bug: add the second hop. Sketch:
     ```ts
     // After collecting 1-hop neighbours, expand once more:
     const secondHopRows = await query<{ source: string; target: string }>(
       `SELECT source, target FROM edges
        WHERE (source = ANY($1::text[]) OR target = ANY($1::text[]))
          AND edge_type IN ('PARALLELS', 'DERIVES_FROM')`,
       [Array.from(reachable)]
     );
     for (const r of secondHopRows) { reachable.add(r.source); reachable.add(r.target); }
     ```
   - Consider a `WITH RECURSIVE` CTE if going beyond 2 hops is ever on the roadmap — cleaner than chained queries and lets you cap depth in one place.
2. Remove `EXPRESSES` from the first query's `edge_type IN (...)` list — concept-graph traversal should only use concept-to-concept edge types (`PARALLELS`, `DERIVES_FROM`). EXPRESSES is chunk-to-concept and belongs only in the second query.
3. Whatever the depth, add a hop-depth constant at the top of the file so it's a single named knob rather than implicit in the query structure.

---

## Suggested order of operations (revised 2026-05-25)

The original ordering put Bug 1 first as "a one-line SELECT fix." That was wrong — see the Bug 1 verification: `chunks` has no `tier` column, so Bug 1 is a scoring redesign, not a one-liner, and it cannot be done in isolation from Bug 2. Revised order:

1. **Bug 4 first.** Pure correctness/clarity, independent of scoring. Getting the graph walk right means the subsequent scoring redesign is evaluated against the intended candidate set.
2. **Bugs 1 + 2 + 3 as one scoring redesign.** They are not separable. Tier-on-vector-results (1), the graph distance fallback (2), and the diversity boost (3) all live in the same `mergeAndRerank` formula. RRF (Bug 2 option b) resolves all three coherently: it normalizes the two legs without a calibrated graph distance, removes the per-chunk tier *multiplier* that Bug 1 showed can't apply to vector results, and turns diversity into a separate post-rerank pass on the unified list. Patching them individually would mean three throwaway patches against a formula that's about to be replaced.

## What I'd want to see before merging fixes

- Unit tests in `src/__tests__/` that lock in the intended behavior for each of these. **VERIFIED (2026-05-25):** the *scoring/rerank* path specifically has zero unit coverage. Two retrieval-adjacent test files exist but neither touches `mergeAndRerank`: `src/__tests__/retrieval.integration.test.ts` is skipped unless `INTEGRATION_TEST=1` and only exercises end-to-end retrieval against a live seeded DB; `src/__tests__/graph.test.ts` covers `extractConcepts` sanitisation and `walkGraph` param alignment (regression for todo:1d6a6709). So a `mergeAndRerank` unit test is greenfield — `mergeAndRerank` is currently a private function in `retriever.ts` and will need to be exported (or tested via `retrieve` with mocked legs) to pin scoring behavior.
- A small evaluation harness: a handful of canonical comparative-religion queries (e.g. "the One," "non-dual awareness," "divine names") with expected cross-tradition coverage in the top-K. Without this, "did the fix help?" is unanswerable.
- A `console.log` or trace flag that dumps the per-chunk score breakdown (`distanceScore`, `tierWeight`, `diversityBoost`, `source`) for one query, so the scoring is inspectable when something looks wrong in production.
