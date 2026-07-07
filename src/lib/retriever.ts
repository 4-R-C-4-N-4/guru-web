/**
 * src/lib/retriever.ts
 *
 * Hybrid retrieval: vector search + concept graph walk, merged and reranked.
 * Top-level export: retrieve(queryText, prefs, topK)
 */

import { query, one } from './db';
import { embed } from './embed';
import { extractConcepts, walkGraph, buildScopeFilter, buildSummaryScopeFilter } from './graph';
import type { RetrievedChunk, UserPreferences } from './types';

/**
 * Main entry point. Runs vector search and graph search in parallel,
 * deduplicates by chunk ID, then reranks by diversity + tier + distance.
 */
export async function retrieve(
  queryText: string,
  prefs: UserPreferences,
  topK: number = 15,
  mode: 'chat' | 'study' = 'chat',
  studyTextId?: string | null
): Promise<RetrievedChunk[]> {
  // Study mode (summary-phase-w.md §W3): both chunk legs pin to the study
  // work's member texts, and a summary leg joins the vector candidates. The
  // chat/compare path below is byte-for-byte the tuned config — mode defaults
  // keep every existing caller on it.
  let studyWorkId: string | null = null;
  if (mode === 'study' && studyTextId) {
    const pin = await one<{ work_id: string; member_text_ids: string[] }>(
      `SELECT w.id AS work_id, w.member_text_ids
       FROM texts t JOIN works w ON w.id = t.work_id
       WHERE t.id = $1`,
      [studyTextId]
    );
    if (pin) {
      studyWorkId = pin.work_id;
      // Pinning reuses the whitelist path of buildScopeFilter verbatim: the
      // pinned work's members become the effective scope for chunk legs.
      prefs = {
        ...prefs,
        scopeMode: 'whitelist',
        whitelistedTraditions: [],
        whitelistedTexts: pin.member_text_ids,
      };
    }
  }
  // Vector candidate-pool multiplier. Widening the pool lets the long tail reach
  // the rarity-aware reranker; alone it churns the head (tuning-experiment.md §1),
  // but PAIRED WITH the lexical leg it's the measured-best cell (Round 4: lexical
  // ×2 → 0.30, ×10 → 0.37). So ×10 is the code DEFAULT, not 2 — the decided config
  // ships by default, no env required. RETRIEVAL_POOL_MULT is an optional override
  // (sweeps without a redeploy). Latency is flat ~18–20ms across widths (Round 1).
  const poolMult = Number(process.env.RETRIEVAL_POOL_MULT) || 10;
  // Lexical leg (todo:0c38a006, defaulted on todo:0b15af21). ON by default — it's
  // the measured precision lever (0.21→0.37), so the good config is the default,
  // not a must-set env flag. RETRIEVAL_LEXICAL=off is an optional kill-switch
  // (revert without a redeploy). The lexical pool is fixed at topK*2 (like graph):
  // FTS is not corpus-size-biased the way the vector leg is, so it skips poolMult.
  const runLexical = process.env.RETRIEVAL_LEXICAL !== 'off';
  let [vectorResults, graphResults, lexicalResults, summaryResults] = await Promise.all([
    vectorSearch(queryText, prefs, topK * poolMult),
    graphSearch(queryText, prefs, topK * 2),
    runLexical ? lexicalSearch(queryText, prefs, topK * 2) : Promise.resolve([] as RetrievedChunk[]),
    studyWorkId
      ? summarySearch(queryText, prefs, topK, studyWorkId)
      : Promise.resolve([] as RetrievedChunk[]),
  ]);

  // Quality filter (todo:9e31302a) — drop corpus apparatus (nav/TOC/errata) and
  // strip boilerplate prefixes from bodies so junk doesn't take top-K slots or
  // pollute display. Env-gated (default off). NOTE: this can't fix the embedding
  // ranking — vectors were computed on the polluted text — so the proper fix is
  // upstream re-embed on clean chunks (todo:b80d8d7d); this is the bridge + a
  // permanent safety net.
  if (process.env.RETRIEVAL_QUALITY_FILTER) {
    vectorResults = applyQualityFilter(vectorResults);
    graphResults = applyQualityFilter(graphResults);
    lexicalResults = applyQualityFilter(lexicalResults);
    // summaryResults deliberately skipped: generated apparatus, not scraped
  }

  // Diversity mode (todo:59060e24). 'live' (default) divides the bump by a
  // tradition's count *in the candidate pool*, which couples ranking to pool
  // composition — so widening the pool churns the head (tuning-experiment.md §4).
  // 'fixed' derives a pool-independent rarity from corpus-wide tradition sizes,
  // so widening intake no longer distorts the rerank. Env-tunable per call.
  const traditionRarity = process.env.RETRIEVAL_DIVERSITY === 'fixed'
    ? await corpusRarity()
    : undefined;

  // Lexical weight: tuned default 1.0 (LEXICAL_WEIGHT const, sweep peak Round 4);
  // RETRIEVAL_LEXICAL_WEIGHT is an optional override for re-sweeping without a redeploy.
  const lexicalWeight = Number(process.env.RETRIEVAL_LEXICAL_WEIGHT) || LEXICAL_WEIGHT;
  // GRAPH_WEIGHT env-tunable too (todo:dafd05d2): now that concept_aliases is
  // populated, the graph leg surfaces transliteration content no other leg
  // reaches — but at the default 0.3 those chunks lose top-K slots to vector
  // hubs. Swept without a redeploy; default is GRAPH_WEIGHT until measured.
  const graphWeight = Number(process.env.RETRIEVAL_GRAPH_WEIGHT) || GRAPH_WEIGHT;

  return mergeAndRerank([...vectorResults, ...summaryResults], graphResults, topK, {
    traditionRarity,
    lexicalResults,
    lexicalWeight,
    graphWeight,
    // A pinned study work is single-tradition: the cap would truncate results
    // to MAX_PER_TRADITION regardless of topK.
    perTraditionCap: studyWorkId ? 0 : undefined,
  });
}

// ---------------------------------------------------------------------------
// Summary leg (study mode; summary-phase-w.md §W3)
// ---------------------------------------------------------------------------

// Vector search over summary_nodes, column-compatible with the chunk legs so
// the reranker and formatChunk need no special cases beyond tier/source:
//   text_name  := COALESCE(texts.label, works.label)  — works fallback covers
//                 multi-member L2 rows where text_id IS NULL (W0 finding 2)
//   section    := COALESCE(section_span, 'Whole work')
//   text_id    := COALESCE(text_id, work_id)          — field is non-nullable
// Exported for unit testing; callers use retrieve().
export async function summarySearch(
  queryText: string,
  prefs: UserPreferences,
  limit: number,
  studyWorkId?: string | null
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embed(queryText);
  const { where, params, paramIndex } = buildSummaryScopeFilter(prefs, 2); // $1 = embedding
  const pinClause = studyWorkId ? `AND s.work_id = $${paramIndex}` : '';

  const rows = await query<RetrievedChunk & { distance: number }>(
    `SELECT s.id,
            COALESCE(s.text_id, s.work_id)         AS text_id,
            s.tradition,
            COALESCE(tx.label, w.label)             AS text_name,
            COALESCE(s.section_span, 'Whole work')  AS section,
            NULL::text                              AS translator,
            s.body, s.token_count,
            (s.embedding <=> $1::vector)            AS distance,
            'summary' AS source
     FROM summary_nodes s
     JOIN works w       ON w.id = s.work_id
     LEFT JOIN texts tx ON tx.id = s.text_id
     WHERE ${where} ${pinClause}
     ORDER BY s.embedding <=> $1::vector
     LIMIT $${paramIndex + (studyWorkId ? 1 : 0)}`,
    [JSON.stringify(queryEmbedding), ...params,
     ...(studyWorkId ? [studyWorkId] : []), limit]
  );

  return rows.map(r => ({ ...r, tier: 'summary' as const }));
}

// Corpus-apparatus patterns (todo:9e31302a; hardened by the guru-repo V8 audit —
// docs/summary/boilerplate-audit.md, todo:fccaf47d). As of the V8 clean the
// corpus ships with bodies already stripped at source; this layer is
// defense-in-depth for pre-V8 exports and future ingest regressions.
// DROP: chunks that are pure navigation/TOC/errata. STRIP: boilerplate baked into
// otherwise-real chunks. Deliberately NOT length-based — the 9-token
// Gospel of Thomas logion is real content.
const APPARATUS_DROP = /^\s*(?:next|previous)\s*:|^\s*errata\b/i;
// V8: hyphenated "Sacred-Texts" and header-without-nav-links forms exist
// (enuma-elish 001 was the reproducer). Ordered alternatives: (1) breadcrumb
// through "Previous Next" (the classic form); (2) hyphenated or capital-T
// breadcrumb line without nav links, eaten to end-of-line — deliberately
// case-sensitive on "Texts" so prose like "sacred texts are…" never matches;
// (3) gnosis.org "Index Previous Next". No /i flag for that reason.
const NAV_PREFIX =
  /^\s*(?:[Ss]acred[- ][Tt]exts?\b[^\n]{0,300}\bPrevious\s+Next\b[ \t]*|Sacred-[Tt]exts?\b[^\n]{0,300}(?:\n+|$)|Sacred\s+Texts\b[^\n]{0,300}(?:\n+|$)|Index\s+Previous\s+Next\b[ \t]*)/;
// V8: `{p. N}` matches zero chunks in the current corpus (vestigial); the live
// form is Gutenberg's inline `[Pg N]`. Keep both — they're cheap.
const PAGE_MARKER = /\{\s*p\.\s*\d+\s*\}|\[\s*pg\.?\s*\d+\s*\]/gi;
// V8: trailing nav pointer glued to the end of a body ("… Next: Section 6").
const NAV_TAIL = /\s*(?:Next|Previous)\s*:\s[^\n]{0,80}$/i;

/** Strip baked-in boilerplate from a chunk body. */
export function cleanBody(body: string): string {
  return body
    .replace(NAV_PREFIX, '')
    .replace(PAGE_MARKER, ' ')
    .replace(NAV_TAIL, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Drop pure-apparatus chunks and strip boilerplate from the rest. Exported for
 *  unit testing; applied in retrieve() only when RETRIEVAL_QUALITY_FILTER is set. */
export function applyQualityFilter(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const out: RetrievedChunk[] = [];
  for (const c of chunks) {
    if (APPARATUS_DROP.test(c.body)) continue; // pure nav/TOC/errata
    const cleaned = cleanBody(c.body);
    if (cleaned.replace(/\W/g, '').length < 3) continue; // nav-only once stripped
    out.push(cleaned === c.body ? c : { ...c, body: cleaned });
  }
  return out;
}

// Corpus-wide tradition sizes → pool-independent rarity in [0,1] (rarest = 1,
// largest = 0), log-scaled so the 841-vs-15 chunk spread doesn't blow up.
// Cached: the corpus is static between deploys. (todo:59060e24 fixed-diversity.)
let _rarity: Map<string, number> | null = null;
async function corpusRarity(): Promise<Map<string, number>> {
  if (_rarity) return _rarity;
  const rows = await query<{ tradition: string; n: number }>(
    `SELECT tradition, count(*)::int AS n FROM chunks GROUP BY tradition`,
  );
  const logs = rows.map(r => Math.log(r.n));
  const lo = Math.min(...logs);
  const span = (Math.max(...logs) - lo) || 1;
  _rarity = new Map(rows.map(r => [r.tradition, (Math.max(...logs) - Math.log(r.n)) / span]));
  return _rarity;
}

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

async function vectorSearch(
  queryText: string,
  prefs: UserPreferences,
  limit: number
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embed(queryText);
  const { where, params, paramIndex } = buildScopeFilter(prefs, 2); // $1 = embedding

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

  return rows;
}

// ---------------------------------------------------------------------------
// Graph search
// ---------------------------------------------------------------------------

async function graphSearch(
  queryText: string,
  prefs: UserPreferences,
  limit: number
): Promise<RetrievedChunk[]> {
  // Measurement toggle (todo:72f1334e): GRAPH_LEG=off isolates the graph leg's
  // contribution to precision so we can tell whether matcher quality even moves
  // the metric. Default on — behaviour-neutral.
  if (process.env.GRAPH_LEG === 'off') return [];
  const concepts = await extractConcepts(queryText);
  if (concepts.length === 0) return [];
  return walkGraph(concepts, prefs, limit);
}

// ---------------------------------------------------------------------------
// Lexical search (todo:af69f5e5)
// ---------------------------------------------------------------------------

// Postgres full-text leg. The dense vector leg barely discriminates on this
// corpus — every cosine sits in ~0.55-0.62, so proper-noun / entity queries
// wash out entirely (tuning-experiment.md Round 3: "Ahura Mazda" returned 0 of
// 152 zoroastrian chunks). FTS catches exactly those: `plainto_tsquery` matches
// the terms and `ts_rank` orders by textual relevance. No index is required at
// this scale (~3k rows seq-scan to_tsvector in <50ms); a GIN index belongs in
// the pipeline-owned corpus export, not the byte-identical schema mirror.
//
// Exported for unit testing (todo:af69f5e5); not part of the public API —
// callers use retrieve(), which runs this leg by default (RETRIEVAL_LEXICAL=off disables).
export async function lexicalSearch(
  queryText: string,
  prefs: UserPreferences,
  limit: number
): Promise<RetrievedChunk[]> {
  const { where, params, paramIndex } = buildScopeFilter(prefs, 2); // $1 = query text

  // plainto_tsquery ANDs every lexeme ('ahura' & 'mazda' & 'gatha'), which
  // matches ~nothing for multi-term entity queries — exactly the queries this
  // leg exists to rescue (0 matches for "Ahura Mazda and the Gathas"; 109 under
  // OR). So flip the sanitised query to OR semantics (& → |) and let ts_rank do
  // the discrimination: a chunk matching more terms ranks higher. plainto_tsquery
  // still does the parsing/sanitisation, so $1 is never interpolated raw.
  const rows = await query<RetrievedChunk & { lex_rank: number }>(
    `WITH q AS (
       SELECT replace(plainto_tsquery('english', $1)::text, ' & ', ' | ')::tsquery AS tsq
     )
     SELECT id, text_id, tradition, text_name, section, translator, body, token_count,
            ts_rank(to_tsvector('english', body), q.tsq) AS lex_rank,
            'lexical' AS source
     FROM chunks, q
     WHERE to_tsvector('english', body) @@ q.tsq
       AND ${where}
     ORDER BY lex_rank DESC
     LIMIT $${paramIndex}`,
    [queryText, ...params, limit]
  );

  // Carry the raw ts_rank as lexRank; mergeAndRerank normalises it (todo:0c38a006).
  return rows.map(({ lex_rank, ...r }) => ({ ...r, lexRank: lex_rank }));
}

// ---------------------------------------------------------------------------
// Merge and rerank
// ---------------------------------------------------------------------------

// Scoring constants, hardcoded to the canonical pipeline defaults
// (guru/retriever.py `ranking` config). This is a faithful port of that
// retriever's additive _merge_and_rank, replacing an earlier divergent
// multiplicative formula. See docs/retriever-hitlist.md and todo:fbf4652f.
const VECTOR_WEIGHT = 0.7;
const GRAPH_WEIGHT = 0.3;
const LEXICAL_WEIGHT = 1.0; // tuned default (todo:3fc23534): swept 0→2.5, peak mean p@10 0.36 at 1.0 (baseline 0.21); env-overridable
const DIVERSITY_BOOST = 0.1; // additive, applied to a tradition's first appearance
const MAX_PER_TRADITION = 3; // hard cap on top-K slots per tradition (0 = uncapped)
const TIER_WEIGHTS: Record<string, number> = { verified: 1.0, proposed: 0.7, inferred: 0.4, summary: 0.4 };

type Tier = NonNullable<RetrievedChunk['tier']>;
function tierWeight(tier: Tier): number {
  return TIER_WEIGHTS[tier] ?? TIER_WEIGHTS.inferred;
}

interface MergedEntry {
  chunk: RetrievedChunk;
  similarity: number; // 1 - cosine distance; 0 for graph-only hits
  tier: Tier;
  graphScore: number; // tier weight of the originating graph edge; 0 for vector-only
  // Query-expansion match weight scaling the graph term (todo:08503113 §6). The
  // value is MATCH_TIER_WEIGHTS (graph.ts) resolved at walk time and carried on
  // the chunk as conceptMatchWeight. 1.0 for vector-only hits (no expansion), so
  // their score is unchanged.
  matchWeight: number;
  // Raw Postgres ts_rank from the lexical leg (todo:0c38a006); 0 for chunks no
  // lexical hit reached. Normalised to [0,1] across the candidate set at scoring
  // time before LEXICAL_WEIGHT is applied — ts_rank is unbounded, so an absolute
  // value isn't comparable to the [0,1] cosine similarity.
  lexScore: number;
}

// Exported for unit testing (todo:d1a94167); not part of the public API —
// callers should use retrieve().
export function mergeAndRerank(
  vectorResults: RetrievedChunk[],
  graphResults: RetrievedChunk[],
  topK: number,
  opts: {
    traditionRarity?: Map<string, number>;
    lexicalResults?: RetrievedChunk[];
    lexicalWeight?: number;
    graphWeight?: number;
    /** Override MAX_PER_TRADITION (0 disables the cap — study mode). */
    perTraditionCap?: number;
  } = {},
): RetrievedChunk[] {
  const merged = new Map<string, MergedEntry>();
  const lexicalResults = opts.lexicalResults ?? [];
  const lexicalWeight = opts.lexicalWeight ?? LEXICAL_WEIGHT;
  const graphWeight = opts.graphWeight ?? GRAPH_WEIGHT;

  // Vector leg. Vector search has no tier signal, so each hit is tagged
  // 'inferred' explicitly (not left undefined and silently floored). Its
  // similarity comes from cosine distance; graphScore stays 0 unless the
  // graph leg also surfaces it below.
  for (const chunk of vectorResults) {
    const similarity = chunk.distance != null ? 1 - chunk.distance : 0;
    // Summary rows keep their 'summary' tier (W0 decision: formatChunk would
    // otherwise mislabel generated apparatus as 'inferred').
    const tier: Tier = chunk.source === 'summary' ? 'summary' : 'inferred';
    merged.set(chunk.id, {
      chunk: { ...chunk, tier },
      similarity,
      tier,
      graphScore: 0,
      matchWeight: 1.0, // vector hit, no query expansion
      lexScore: 0,
    });
  }

  // Graph leg. A graph hit contributes graphScore = the tier weight of the
  // EXPRESSES edge it arrived on — an independent additive signal, not a
  // faked distance. When a chunk appears in both legs, keep the vector
  // similarity but adopt the stronger tier.
  for (const chunk of graphResults) {
    const gTier = (chunk.tier ?? 'inferred') as Tier;
    const gWeight = tierWeight(gTier);
    // How strongly the query reached this chunk's concept (concept/family/domain).
    // Graph chunks always carry it; fall back to 1.0 defensively.
    const gMatchW = chunk.conceptMatchWeight ?? 1.0;
    const existing = merged.get(chunk.id);
    if (existing) {
      if (gWeight > tierWeight(existing.tier)) {
        existing.tier = gTier;
        existing.chunk = { ...existing.chunk, tier: gTier };
      }
      existing.graphScore = Math.max(existing.graphScore, gWeight);
      existing.matchWeight = gMatchW; // graph-derived scaler for the graph term
    } else {
      merged.set(chunk.id, { chunk, similarity: 0, tier: gTier, graphScore: gWeight, matchWeight: gMatchW, lexScore: 0 });
    }
  }

  // Lexical leg (todo:0c38a006). Each FTS hit contributes its raw ts_rank as an
  // independent additive signal (normalised below). When a chunk also came from
  // the vector/graph legs, keep their similarity/tier and just record lexScore;
  // a lexical-only hit enters as a fresh inferred candidate. This is what
  // rescues proper-noun / entity queries the dense leg washes out.
  for (const chunk of lexicalResults) {
    const rank = chunk.lexRank ?? 0;
    const existing = merged.get(chunk.id);
    if (existing) {
      existing.lexScore = Math.max(existing.lexScore, rank);
    } else {
      merged.set(chunk.id, {
        chunk: { ...chunk, tier: 'inferred' },
        similarity: 0,
        tier: 'inferred',
        graphScore: 0,
        matchWeight: 1.0,
        lexScore: rank,
      });
    }
  }

  // Diversity: count each tradition across the whole merged candidate set
  // first, then boost rarer traditions more. This is continuous and
  // order-independent — a tradition with a single candidate gets the full
  // bump, while an over-represented tradition's bump is divided across its
  // many candidates, so rarity is rewarded rather than first-appearance.
  const entries = Array.from(merged.values());
  const traditionCounts = new Map<string, number>();
  for (const e of entries) {
    traditionCounts.set(e.chunk.tradition, (traditionCounts.get(e.chunk.tradition) ?? 0) + 1);
  }

  // ts_rank is unbounded and corpus-relative, so it isn't comparable to the
  // [0,1] cosine similarity until normalised. Max-normalise across the candidate
  // set (todo:0c38a006): the strongest lexical hit scores 1.0 × LEXICAL_WEIGHT,
  // the rest scale down proportionally. Pool-relative, like the 'live' diversity
  // term — fine here because lexical is a complementary ranker, not the spine.
  const maxLex = Math.max(0, ...entries.map(e => e.lexScore));

  // Additive score: weighted vector similarity + weighted graph signal +
  // rarity-weighted diversity bump. Components are retained so the optional
  // RETRIEVAL_TRACE breakdown below is the real scoring, not a re-derivation.
  const scored = entries.map(entry => {
    const tierW = tierWeight(entry.tier);
    // Scale ONLY the graph term by the query-expansion match weight — the vector
    // leg and the additive combination are untouched (todo:08503113 §6). A
    // domain-tier graph hit thus contributes ¼ of a concept-tier hit's graph term.
    const graphTerm = Math.max(tierW, entry.graphScore) * entry.matchWeight;
    // 'fixed': pool-independent corpus rarity (todo:59060e24). 'live' (legacy):
    // divide the bump by the tradition's count in this pool.
    const diversity = opts.traditionRarity
      ? DIVERSITY_BOOST * (opts.traditionRarity.get(entry.chunk.tradition) ?? 0)
      : DIVERSITY_BOOST / (traditionCounts.get(entry.chunk.tradition) ?? 1);
    // Normalised lexical term — 0 when there are no lexical hits (leg off), so
    // the score reduces exactly to the vector+graph+diversity sum.
    const lexTerm = maxLex > 0 ? lexicalWeight * (entry.lexScore / maxLex) : 0;
    const score = VECTOR_WEIGHT * entry.similarity + graphWeight * graphTerm + lexTerm + diversity;
    return { entry, score, tierW, diversity, lexTerm };
  });

  scored.sort((a, b) => b.score - a.score);

  // Opt-in score trace (set RETRIEVAL_TRACE=1). Off by default — no prod cost.
  if (process.env.RETRIEVAL_TRACE) {
    console.log(
      `[retrieval-trace] ${scored.length} candidates (vec_w=${VECTOR_WEIGHT} graph_w=${graphWeight} lex_w=${lexicalWeight} cap=${MAX_PER_TRADITION}):`,
    );
    for (const s of scored.slice(0, topK)) {
      console.log(
        `  ${s.score.toFixed(3)}  ${s.entry.chunk.source.padEnd(7)} ${s.entry.chunk.tradition.padEnd(20)}` +
          ` sim=${s.entry.similarity.toFixed(3)} tierW=${s.tierW.toFixed(2)}(${s.entry.tier})` +
          ` graphS=${s.entry.graphScore.toFixed(2)} matchW=${s.entry.matchWeight.toFixed(2)}` +
          ` lex=${s.lexTerm.toFixed(3)} div=${s.diversity.toFixed(3)}  ${s.entry.chunk.id}`,
      );
    }
  }

  // Emit top-K, capping how many slots any one tradition can take so a
  // single well-connected tradition can't flood the results.
  const tradCounts = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const { entry } of scored) {
    if (out.length >= topK) break;
    const trad = entry.chunk.tradition;
    const cap = opts.perTraditionCap ?? MAX_PER_TRADITION;
    if (cap > 0 && (tradCounts.get(trad) ?? 0) >= cap) continue;
    out.push(entry.chunk);
    tradCounts.set(trad, (tradCounts.get(trad) ?? 0) + 1);
  }
  return out;
}
