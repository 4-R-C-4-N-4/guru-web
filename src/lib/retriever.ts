/**
 * src/lib/retriever.ts
 *
 * Hybrid retrieval: vector search + concept graph walk, merged and reranked.
 * Top-level export: retrieve(queryText, prefs, topK)
 */

import { query } from './db';
import { embed } from './embed';
import { extractConcepts, walkGraph, buildScopeFilter } from './graph';
import type { RetrievedChunk, UserPreferences } from './types';

/**
 * Main entry point. Runs vector search and graph search in parallel,
 * deduplicates by chunk ID, then reranks by diversity + tier + distance.
 */
export async function retrieve(
  queryText: string,
  prefs: UserPreferences,
  topK: number = 15
): Promise<RetrievedChunk[]> {
  const [vectorResults, graphResults] = await Promise.all([
    vectorSearch(queryText, prefs, topK * 2),
    graphSearch(queryText, prefs, topK * 2),
  ]);

  return mergeAndRerank(vectorResults, graphResults, topK);
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
  const concepts = await extractConcepts(queryText);
  if (concepts.length === 0) return [];
  return walkGraph(concepts, prefs, limit);
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
const DIVERSITY_BOOST = 0.1; // additive, applied to a tradition's first appearance
const MAX_PER_TRADITION = 3; // hard cap on top-K slots per tradition (0 = uncapped)
const TIER_WEIGHTS: Record<string, number> = { verified: 1.0, proposed: 0.7, inferred: 0.4 };

type Tier = NonNullable<RetrievedChunk['tier']>;
function tierWeight(tier: Tier): number {
  return TIER_WEIGHTS[tier] ?? TIER_WEIGHTS.inferred;
}

interface MergedEntry {
  chunk: RetrievedChunk;
  similarity: number; // 1 - cosine distance; 0 for graph-only hits
  tier: Tier;
  graphScore: number; // tier weight of the originating graph edge; 0 for vector-only
}

function mergeAndRerank(
  vectorResults: RetrievedChunk[],
  graphResults: RetrievedChunk[],
  topK: number
): RetrievedChunk[] {
  const merged = new Map<string, MergedEntry>();

  // Vector leg. Vector search has no tier signal, so each hit is tagged
  // 'inferred' explicitly (not left undefined and silently floored). Its
  // similarity comes from cosine distance; graphScore stays 0 unless the
  // graph leg also surfaces it below.
  for (const chunk of vectorResults) {
    const similarity = chunk.distance != null ? 1 - chunk.distance : 0;
    merged.set(chunk.id, {
      chunk: { ...chunk, tier: 'inferred' },
      similarity,
      tier: 'inferred',
      graphScore: 0,
    });
  }

  // Graph leg. A graph hit contributes graphScore = the tier weight of the
  // EXPRESSES edge it arrived on — an independent additive signal, not a
  // faked distance. When a chunk appears in both legs, keep the vector
  // similarity but adopt the stronger tier.
  for (const chunk of graphResults) {
    const gTier = (chunk.tier ?? 'inferred') as Tier;
    const gWeight = tierWeight(gTier);
    const existing = merged.get(chunk.id);
    if (existing) {
      if (gWeight > tierWeight(existing.tier)) {
        existing.tier = gTier;
        existing.chunk = { ...existing.chunk, tier: gTier };
      }
      existing.graphScore = Math.max(existing.graphScore, gWeight);
    } else {
      merged.set(chunk.id, { chunk, similarity: 0, tier: gTier, graphScore: gWeight });
    }
  }

  // Additive score: weighted vector similarity + weighted graph signal +
  // a one-off diversity bump for the first chunk seen from each tradition.
  const traditionsSeen = new Set<string>();
  const scored = Array.from(merged.values()).map(entry => {
    const diversity = traditionsSeen.has(entry.chunk.tradition) ? 0 : DIVERSITY_BOOST;
    traditionsSeen.add(entry.chunk.tradition);
    const score =
      VECTOR_WEIGHT * entry.similarity +
      GRAPH_WEIGHT * Math.max(tierWeight(entry.tier), entry.graphScore) +
      diversity;
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Emit top-K, capping how many slots any one tradition can take so a
  // single well-connected tradition can't flood the results.
  const tradCounts = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const { entry } of scored) {
    if (out.length >= topK) break;
    const trad = entry.chunk.tradition;
    if (MAX_PER_TRADITION > 0 && (tradCounts.get(trad) ?? 0) >= MAX_PER_TRADITION) continue;
    out.push(entry.chunk);
    tradCounts.set(trad, (tradCounts.get(trad) ?? 0) + 1);
  }
  return out;
}
