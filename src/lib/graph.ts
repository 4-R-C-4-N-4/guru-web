/**
 * src/lib/graph.ts
 *
 * Concept graph SQL queries.
 * - extractConcepts: keyword match against concept labels in DB
 * - walkGraph: traverse edges from matched concepts to fetch related chunks
 */

import { query } from './db';
import type { ConceptMatch, MatchTier, QueryExpansion, RetrievedChunk, UserPreferences } from './types';

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
 * Query-expansion match-tier weights (todo:522f389a §6). A concept matched
 * directly counts full; a family-expanded concept half; a domain-expanded
 * concept a quarter. walkGraph stamps the resulting weight onto each graph-leg
 * chunk as `conceptMatchWeight`, which the retriever multiplies into the graph
 * term. SEPARATE axis from the EXPRESSES edge tier (verified/proposed/inferred).
 * Starting values (handoff §7) — tune against the golden set, not breadth.
 */
export const MATCH_TIER_WEIGHTS: Record<MatchTier, number> = {
  concept: 1.0,
  family: 0.5,
  domain: 0.25,
};

/** Strongest-wins ranking when one concept is matched at several tiers. */
const MATCH_TIER_RANK: Record<MatchTier, number> = { concept: 3, family: 2, domain: 1 };

/**
 * Query function-word stopwords (todo:597d86a4). Concept/family/domain matching
 * is substring LIKE, so common short function words leak in — e.g. "the"
 * substring-matched "Theology" and pulled the whole domain into nearly every
 * query, with a spurious transparency chip. A length filter alone can't fix this
 * without also dropping meaningful short terms, so we drop function words
 * explicitly. INTENTIONALLY CONSERVATIVE — function words only; content terms
 * like "one" (the One), "all" (the All), "way" (the Way), "being", "self",
 * "god" are deliberately NOT listed. Grow with care (see todo:59060e24).
 */
const STOPWORDS = new Set([
  'the', 'and', 'are', 'but', 'for', 'not', 'you', 'your', 'our', 'their', 'them',
  'they', 'with', 'that', 'this', 'these', 'those', 'from', 'into', 'what', 'which',
  'who', 'whom', 'whose', 'why', 'how', 'where', 'when', 'than', 'then', 'there',
  'here', 'such', 'also', 'been', 'does', 'did', 'has', 'have', 'had', 'was', 'were',
  'about', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'very', 'just',
  'only', 'more', 'most', 'some', 'any', 'each', 'both', 'few', 'own',
]);

/**
 * Tokenize a query for concept matching: lowercase, strip LIKE wildcards, split
 * on whitespace, drop tokens ≤2 chars and function-word stopwords. Shared by
 * extractConcepts and summarizeExpansion so the two can never diverge.
 */
function tokenizeQuery(queryText: string): string[] {
  return queryText
    .toLowerCase()
    .replace(/[%_]/g, '') // strip LIKE wildcards before matching
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

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
  const words = tokenizeQuery(queryText);
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
 * Summarise how a query fanned out, for query-expansion transparency
 * (todo:9d2ad427 §8): the family/domain labels a query matched and how many
 * concepts each pulled in. Concept-tier (1:1) matches are excluded — only
 * genuine expansions are interesting to show. A transparency-only sibling of
 * extractConcepts (same tokenisation), run on the chat path alongside retrieve;
 * it returns [] when nothing expanded, so the UI shows a chip only when there's
 * a real fan-out. Alias legs are inert until the alias tables fill.
 */
export async function summarizeExpansion(queryText: string): Promise<QueryExpansion[]> {
  const words = tokenizeQuery(queryText);
  if (words.length === 0) return [];

  const params = words.map(w => `%${w}%`);
  const anyWord = (expr: string) => words.map((_, i) => `${expr} LIKE $${i + 1}`).join(' OR ');

  const rows = await query<{ tier: 'family' | 'domain'; label: string; n: number }>(
    `SELECT 'family' AS tier, f.label, COUNT(DISTINCT m.concept_id)::int AS n
       FROM concept_families f
       JOIN concept_family_membership m ON m.family_id = f.id
      WHERE f.parent_id IS NOT NULL AND (${anyWord('LOWER(f.label)')})
      GROUP BY f.id, f.label
     UNION ALL
     SELECT 'family', f.label, COUNT(DISTINCT m.concept_id)::int
       FROM family_aliases fa
       JOIN concept_families f ON f.id = fa.family_id
       JOIN concept_family_membership m ON m.family_id = f.id
      WHERE f.parent_id IS NOT NULL AND (${anyWord('fa.alias')})
      GROUP BY f.id, f.label
     UNION ALL
     SELECT 'domain', d.label, COUNT(DISTINCT m.concept_id)::int
       FROM concept_families d
       JOIN concept_families f ON f.parent_id = d.id
       JOIN concept_family_membership m ON m.family_id = f.id
      WHERE d.parent_id IS NULL AND (${anyWord('LOWER(d.label)')})
      GROUP BY d.id, d.label
     UNION ALL
     SELECT 'domain', d.label, COUNT(DISTINCT m.concept_id)::int
       FROM family_aliases da
       JOIN concept_families d ON d.id = da.family_id AND d.parent_id IS NULL
       JOIN concept_families f ON f.parent_id = d.id
       JOIN concept_family_membership m ON m.family_id = f.id
      WHERE ${anyWord('da.alias')}
      GROUP BY d.id, d.label`,
    params
  );

  // A family/domain matched by both its label and an alias yields duplicate
  // rows — collapse on tier+label (the count is identical per family).
  const seen = new Map<string, QueryExpansion>();
  for (const r of rows) {
    const key = `${r.tier}:${r.label}`;
    if (!seen.has(key)) seen.set(key, { tier: r.tier, label: r.label, conceptCount: r.n });
  }
  return Array.from(seen.values());
}

/**
 * Walk the concept graph starting from the given concept matches.
 * Fetches chunks that EXPRESSES any concept reachable within HOP_DEPTH
 * concept→concept hops (currently 1), and stamps each chunk with the strongest
 * query-expansion match weight among the concepts it expresses
 * (`conceptMatchWeight`, consumed by the retriever's graph term).
 * Respects user tradition/text scope preferences.
 */
export async function walkGraph(
  matches: ConceptMatch[],
  prefs: UserPreferences,
  limit: number
): Promise<RetrievedChunk[]> {
  if (matches.length === 0) return [];

  // Reachable concept → query-expansion match weight. Seeds carry the weight of
  // the tier they were matched at; a concept discovered by a hop inherits the
  // weight of the frontier concept that reached it (todo:522f389a §5.2).
  const reachable = new Map<string, number>();
  for (const m of matches) {
    const w = MATCH_TIER_WEIGHTS[m.matchTier];
    reachable.set(m.conceptId, Math.max(reachable.get(m.conceptId) ?? 0, w));
  }

  // Expand the reachable concept set outward HOP_DEPTH concept→concept hops.
  // Each hop only queries the newly-discovered frontier, so depth > 1 doesn't
  // re-scan concepts already reached.
  let frontier = matches.map(m => m.conceptId);
  for (let hop = 0; hop < HOP_DEPTH; hop++) {
    const neighbourRows = await query<{ source: string; target: string }>(
      `SELECT source, target FROM edges
       WHERE (source = ANY($1::text[]) OR target = ANY($1::text[]))
         AND edge_type = ANY($2::text[])`,
      [frontier, CONCEPT_EDGE_TYPES]
    );

    // Each edge touches the frontier on at least one endpoint (query filter), so
    // exactly the *other* endpoint can be new — it inherits the reached node's
    // weight. First reach wins if two parents discover the same node this hop.
    const next: string[] = [];
    for (const r of neighbourRows) {
      const sw = reachable.get(r.source);
      const tw = reachable.get(r.target);
      if (sw === undefined && tw !== undefined) { reachable.set(r.source, tw); next.push(r.source); }
      else if (tw === undefined && sw !== undefined) { reachable.set(r.target, sw); next.push(r.target); }
    }
    if (next.length === 0) break; // no new concepts — further hops are no-ops
    frontier = next;
  }

  // Find chunks that EXPRESSES any reachable concept. Select the concept
  // (target) too, so each chunk can take the strongest match weight among the
  // reachable concepts it expresses.
  const expressEdges = await query<{ source: string; target: string; tier: string }>(
    `SELECT source, target, tier FROM edges
     WHERE target = ANY($1::text[])
       AND edge_type = 'EXPRESSES'`,
    [Array.from(reachable.keys())]
  );

  if (expressEdges.length === 0) return [];

  const tierMap = new Map<string, string>();
  const weightMap = new Map<string, number>();
  for (const e of expressEdges) {
    tierMap.set(e.source, e.tier); // EXPRESSES edge confidence tier (last-wins, unchanged)
    const w = reachable.get(e.target) ?? 0;
    weightMap.set(e.source, Math.max(weightMap.get(e.source) ?? 0, w));
  }

  const chunkIds = [...new Set(expressEdges.map(e => e.source))];

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
    conceptMatchWeight: weightMap.get(chunk.id) ?? 0,
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
