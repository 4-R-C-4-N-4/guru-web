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

function mergeAndRerank(
  vectorResults: RetrievedChunk[],
  graphResults: RetrievedChunk[],
  topK: number
): RetrievedChunk[] {
  // Deduplicate — vector results take priority (they carry distance scores)
  const seen = new Map<string, RetrievedChunk>();
  for (const chunk of vectorResults) seen.set(chunk.id, chunk);
  for (const chunk of graphResults) {
    if (!seen.has(chunk.id)) seen.set(chunk.id, chunk);
  }

  const merged = Array.from(seen.values());

  // Score: tradition diversity × tier weight × (1 - distance)
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

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.chunk);
}
