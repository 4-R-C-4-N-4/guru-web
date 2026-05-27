/**
 * src/lib/graph.ts
 *
 * Concept graph SQL queries.
 * - extractConcepts: keyword match against concept labels in DB
 * - walkGraph: traverse edges from matched concepts to fetch related chunks
 */

import { query } from './db';
import type { ConceptMatch, MatchTier, RetrievedChunk, UserPreferences } from './types';

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

/** Strongest-wins ranking when one concept is matched at several tiers. */
const MATCH_TIER_RANK: Record<MatchTier, number> = { concept: 3, family: 2, domain: 1 };

/**
 * Extract concepts from free text, matching query words **simultaneously across
 * three namespaces** (todo:30dca55e §5.1; handoff §3.1) — not priority-ordered:
 *
 *   1. concept — concepts.label + concept_aliases.alias            → tier 'concept'
 *   2. family  — concept_families.label + family_aliases.alias     → tier 'family'
 *                (expands to every concept with a membership in that family)
 *   3. domain  — domain-row label + its family_aliases             → tier 'domain'
 *                (every concept whose family's parent is that domain)
 *
 * Read-side ignores is_primary — primary and secondary memberships are co-equal
 * for expansion. A concept matched at multiple tiers is returned once at its
 * strongest tier. Substring LIKE on lowercased values throughout. Alias legs are
 * correct but inert until the alias tables are populated (handoff §4), so they
 * simply contribute no rows today.
 */
export async function extractConcepts(queryText: string): Promise<ConceptMatch[]> {
  const words = queryText
    .toLowerCase()
    .replace(/[%_]/g, '')       // strip LIKE wildcards before matching
    .split(/\s+/)
    .filter(w => w.length > 2); // skip short stop-words

  if (words.length === 0) return [];

  const params = words.map(w => `%${w}%`);
  // Each leg ORs the same $1..$N word patterns against its own column.
  const anyWord = (expr: string) => words.map((_, i) => `${expr} LIKE $${i + 1}`).join(' OR ');

  const rows = await query<{ concept_id: string; match_tier: MatchTier }>(
    `SELECT c.id AS concept_id, 'concept' AS match_tier
       FROM concepts c
      WHERE ${anyWord('LOWER(c.label)')}
     UNION ALL
     SELECT ca.concept_id, 'concept'
       FROM concept_aliases ca
      WHERE ${anyWord('ca.alias')}
     UNION ALL
     SELECT m.concept_id, 'family'
       FROM concept_families f
       JOIN concept_family_membership m ON m.family_id = f.id
      WHERE f.parent_id IS NOT NULL AND (${anyWord('LOWER(f.label)')})
     UNION ALL
     SELECT m.concept_id, 'family'
       FROM family_aliases fa
       JOIN concept_families f ON f.id = fa.family_id
       JOIN concept_family_membership m ON m.family_id = f.id
      WHERE f.parent_id IS NOT NULL AND (${anyWord('fa.alias')})
     UNION ALL
     SELECT m.concept_id, 'domain'
       FROM concept_families d
       JOIN concept_families f ON f.parent_id = d.id
       JOIN concept_family_membership m ON m.family_id = f.id
      WHERE d.parent_id IS NULL AND (${anyWord('LOWER(d.label)')})
     UNION ALL
     SELECT m.concept_id, 'domain'
       FROM family_aliases da
       JOIN concept_families d ON d.id = da.family_id AND d.parent_id IS NULL
       JOIN concept_families f ON f.parent_id = d.id
       JOIN concept_family_membership m ON m.family_id = f.id
      WHERE ${anyWord('da.alias')}`,
    params
  );

  // Dedupe by concept, keeping the strongest tier. Map preserves first-seen
  // order, so the concept namespace (first leg) anchors a stable order.
  const best = new Map<string, MatchTier>();
  for (const r of rows) {
    const cur = best.get(r.concept_id);
    if (!cur || MATCH_TIER_RANK[r.match_tier] > MATCH_TIER_RANK[cur]) {
      best.set(r.concept_id, r.match_tier);
    }
  }
  return Array.from(best, ([conceptId, matchTier]) => ({ conceptId, matchTier }));
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
