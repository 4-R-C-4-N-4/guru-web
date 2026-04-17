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
 * Extract concept IDs from free text by keyword-matching concept labels.
 * Phase 1 implementation: simple LIKE match against each word in the query.
 */
export async function extractConcepts(queryText: string): Promise<string[]> {
  const words = queryText
    .toLowerCase()
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
 * Fetches chunks that EXPRESSES any concept reachable within 1–2 hops.
 * Respects user tradition/text scope preferences.
 */
export async function walkGraph(
  conceptIds: string[],
  prefs: UserPreferences,
  limit: number
): Promise<RetrievedChunk[]> {
  if (conceptIds.length === 0) return [];

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

  if (expressEdges.length === 0) return [];

  const chunkIds = expressEdges.map(e => e.source);
  const tierMap = new Map(expressEdges.map(e => [e.source, e.tier]));

  // Build scope filter
  const { where, params, paramIndex } = buildScopeFilter(prefs, 1);

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
