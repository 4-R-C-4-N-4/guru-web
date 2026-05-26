/**
 * src/lib/graph.ts
 *
 * Concept graph SQL queries.
 * - extractConcepts: keyword match against concept labels in DB
 * - walkGraph: traverse edges from matched concepts to fetch related chunks
 */

import { query } from './db';
import type { RetrievedChunk, UserPreferences } from './types';

/**
 * Number of concept→concept hops to expand out from the seed concepts
 * before collecting the chunks that express them. The single knob for
 * graph-walk breadth.
 *
 * Kept at 1 deliberately (todo:d0b40ad4): a single PARALLELS/DERIVES_FROM
 * hop already crosses traditions, and widening to 2 materially grows the
 * candidate set and latency. Bump this only alongside the retrieval eval
 * harness that can confirm the extra breadth improves quality rather than
 * adding noise — see docs/retriever-hitlist.md.
 */
const HOP_DEPTH = 1;

/**
 * Concept-graph edge types — concept↔concept only. EXPRESSES is a
 * chunk→concept edge and is intentionally excluded here; it is handled by
 * the expressing-chunk lookup in walkGraph, not by reachability expansion.
 */
const CONCEPT_EDGE_TYPES = ['PARALLELS', 'DERIVES_FROM'];

/**
 * Extract concept IDs from free text by keyword-matching concept labels.
 * Phase 1 implementation: simple LIKE match against each word in the query.
 */
export async function extractConcepts(queryText: string): Promise<string[]> {
  const words = queryText
    .toLowerCase()
    .replace(/[%_]/g, '')       // strip LIKE wildcards before matching
    .split(/\s+/)
    .filter(w => w.length > 2); // skip short stop-words

  if (words.length === 0) return [];

  const conditions = words.map((_, i) => `LOWER(label) LIKE $${i + 1}`).join(' OR ');
  const params = words.map(w => `%${w}%`);

  const rows = await query<{ id: string }>(
    `SELECT id FROM concepts WHERE ${conditions}`,
    params
  );

  return rows.map(r => r.id);
}

/**
 * Walk the concept graph starting from the given concept IDs.
 * Fetches chunks that EXPRESSES any concept reachable within HOP_DEPTH
 * concept→concept hops (currently 1).
 * Respects user tradition/text scope preferences.
 */
export async function walkGraph(
  conceptIds: string[],
  prefs: UserPreferences,
  limit: number
): Promise<RetrievedChunk[]> {
  if (conceptIds.length === 0) return [];

  // Expand the reachable concept set outward HOP_DEPTH concept→concept
  // hops. Each hop only queries the newly-discovered frontier, so depth > 1
  // doesn't re-scan concepts already reached.
  const reachable = new Set<string>(conceptIds);
  let frontier = conceptIds;
  for (let hop = 0; hop < HOP_DEPTH; hop++) {
    const neighbourRows = await query<{ source: string; target: string }>(
      `SELECT source, target FROM edges
       WHERE (source = ANY($1::text[]) OR target = ANY($1::text[]))
         AND edge_type = ANY($2::text[])`,
      [frontier, CONCEPT_EDGE_TYPES]
    );

    const next: string[] = [];
    for (const r of neighbourRows) {
      if (!reachable.has(r.source)) { reachable.add(r.source); next.push(r.source); }
      if (!reachable.has(r.target)) { reachable.add(r.target); next.push(r.target); }
    }
    if (next.length === 0) break; // no new concepts — further hops are no-ops
    frontier = next;
  }

  // Find chunks that EXPRESSES any reachable concept
  const expressEdges = await query<{ source: string; tier: string }>(
    `SELECT source, tier FROM edges
     WHERE target = ANY($1::text[])
       AND edge_type = 'EXPRESSES'`,
    [Array.from(reachable)]
  );

  if (expressEdges.length === 0) return [];

  const chunkIds = expressEdges.map(e => e.source);
  const tierMap = new Map(expressEdges.map(e => [e.source, e.tier]));

  // $1 is taken by the chunkIds ANY clause below, so scope filter starts at $2.
  const { where, params, paramIndex } = buildScopeFilter(prefs, 2);

  const rows = await query<RetrievedChunk>(
    `SELECT id, text_id, tradition, text_name, section, translator, body, token_count
     FROM chunks
     WHERE id = ANY($1::text[])
       AND ${where}
     LIMIT $${paramIndex}`,
    [chunkIds, ...params, limit]
  );

  return rows.map(chunk => ({
    ...chunk,
    source: 'graph' as const,
    tier: (tierMap.get(chunk.id) ?? 'inferred') as RetrievedChunk['tier'],
  }));
}

/** Build a WHERE clause fragment for tradition/text scope preferences. */
export function buildScopeFilter(
  prefs: UserPreferences,
  startIndex: number = 2
): { where: string; params: unknown[]; paramIndex: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = startIndex;

  if (prefs.scopeMode === 'blacklist') {
    if (prefs.blockedTraditions.length > 0) {
      conditions.push(`tradition <> ALL($${paramIndex}::text[])`);
      params.push(prefs.blockedTraditions);
      paramIndex++;
    }
    if (prefs.blockedTexts.length > 0) {
      conditions.push(`text_id <> ALL($${paramIndex}::text[])`);
      params.push(prefs.blockedTexts);
      paramIndex++;
    }
  } else if (prefs.scopeMode === 'whitelist') {
    if (prefs.whitelistedTraditions.length > 0) {
      conditions.push(`tradition = ANY($${paramIndex}::text[])`);
      params.push(prefs.whitelistedTraditions);
      paramIndex++;
    }
    if (prefs.whitelistedTexts.length > 0) {
      conditions.push(`text_id = ANY($${paramIndex}::text[])`);
      params.push(prefs.whitelistedTexts);
      paramIndex++;
    }
  }

  return {
    where: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
    params,
    paramIndex,
  };
}
