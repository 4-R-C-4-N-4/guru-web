/**
 * src/lib/atlas.ts
 *
 * "State of the Atlas" analysis layer (todo:526a20c3) — the deterministic half
 * of the recurring corpus-analysis essay. computeAtlasSnapshot() runs pure SQL
 * over corpus.* and returns a structured, reproducible snapshot: the numbers,
 * rankings, and exemplar cited passages the essay is composed against.
 *
 * Two invariants make this trustworthy:
 *   1. The quality signal is `tier`, never `weight` — every edge ships
 *      weight=NULL (verified across all 33,260 edges). Headline claims are
 *      tier-gated to 'verified'.
 *   2. Centrality is reported BOTH raw and normalized (parallels ÷ chunk count),
 *      so the essay can separate genuine bridging from corpus over-sampling
 *      (Neoplatonism has the most chunks AND the most parallels).
 *
 * Everything here is facts from the DB — the LLM composition layer may weave
 * these numbers but must never invent or alter one.
 */

import { query, one } from './db';

// A primary-source passage behind a cataloged association — enough to cite.
export interface AtlasChunk {
  id: string;
  text_id: string;
  tradition: string;
  text_name: string;
  section: string;
  translator: string | null;
  tier: string;
  body: string;
  token_count: number;
}

// One verified cross-tradition parallel, both passages it joins.
export interface AtlasParallel {
  a: AtlasChunk; // source-side passage
  b: AtlasChunk; // target-side passage
}

// An explicit CONTRASTS edge: the two passages plus the corpus's curated
// annotation of HOW they diverge — the first-class evidence for "where it breaks".
export interface AtlasContrast extends AtlasParallel {
  annotation: string | null;
}

export interface AtlasSnapshot {
  generatedAt: string;        // ISO timestamp, injected by the caller (reproducible/testable)
  schemaVersion: string;      // corpus.corpus_metadata schema_version
  headline: {
    traditions: number;
    concepts: number;
    families: number;
    parallelsVerified: number;
    parallelsProposed: number;
    contrasts: number;
  };
  // Top cross-tradition pairs by verified-parallel count.
  traditionMatrix: Array<{ a: string; b: string; parallels: number }>;
  // Per-tradition reach: raw degree + normalized (per 100 chunks).
  centrality: Array<{
    tradition: string;
    chunks: number;
    parallelDegree: number;
    partnerTraditions: number;
    parallelsPer100Chunks: number;
  }>;
  // Concepts that recur across the most traditions (the candidate "universals"),
  // each situated in its domain → family.
  bridgeConcepts: Array<{
    label: string;
    domain: string | null;
    family: string | null;
    traditions: number;
    mentions: number;
  }>;
  // The same EXPRESSES spread rolled up to the FAMILY layer — the hierarchy's
  // load-bearing clusters (e.g. "Divine Nature", "Union And Return"), which
  // pool related concepts that are really facets of one structure.
  familyBridges: Array<{
    id: string;
    label: string;
    domain: string;
    traditions: number;
    concepts: number;
    mentions: number;
  }>;
  // The full concept map: domain → family → concepts. The corpus's formative
  // structure, made available so the essay can read tags in the hierarchy
  // rather than as a flat list.
  hierarchy: Array<{
    domain: string;
    families: Array<{ id: string; label: string; concepts: string[] }>;
  }>;
  // The v4 document-knowledge layer at a glance: how much of the corpus is
  // covered by curated works/dossiers and generated hierarchical summaries.
  // Older stored snapshots (pre-v4 editions) simply lack this field.
  documentLayer: {
    works: number;
    dossiers: number;            // works with a curated dossier
    summaryNodesL1: number;      // section-span summaries
    summaryNodesL2: number;      // whole-work summaries
  };
  // Low-historical-contact pairs that still resonate — the evidential crux.
  longRangeCases: Array<{
    a: string;
    b: string;
    parallels: number;
    exemplars: AtlasParallel[];
  }>;
  // The explicit divergences (rare — 8 in the current corpus), each with its
  // curated annotation describing how the two passages diverge.
  contrasts: AtlasContrast[];
  // One capsule per work behind the cited exemplar/contrast passages (deduped):
  // the curated dossier's framing of what each work IS. Apparatus for the
  // essayist to situate quotes — never itself citable evidence. Works without
  // a dossier are simply absent (normal partial coverage, phase-w W0 f.4).
  dossierCapsules: AtlasDossierCapsule[];
}

export interface AtlasDossierCapsule {
  work_id: string;
  work_label: string;
  tradition: string;
  summary: string;
  context: string;
  themes: string[];   // concept ids resolved to display labels
  text_ids: string[]; // the cited texts this work covers — lets the prompt drop
                      // capsules whose passages fell out of the token budget
}

// Tradition pairs with little-to-no historical contact: the strongest evidence
// for resonance that diffusion can't explain. Taoism vs the Hellenic-Mediterranean
// world; the ancient Near East pair. Kept as an explicit, auditable list rather
// than inferred, so the "hard cases" selection is transparent.
const LONG_RANGE_PAIRS: Array<[string, string]> = [
  ['neoplatonism', 'taoism'],
  ['greek_mystery', 'taoism'],
  ['christian_mysticism', 'taoism'],
  ['taoism', 'hermeticism'],
  ['egyptian', 'mesopotamian'],
  ['buddhism', 'neoplatonism'],
];

const EXEMPLARS_PER_CASE = 2;

// Prefer exemplars where BOTH sides are near this token length. Targeting the
// pair's SUM (an earlier attempt) let a substantive passage carry a thin one —
// the corpus has table-of-contents / heading stubs (e.g. "THE THIRD ENNEAD
// Next: FIRST TRACTATE", ~10 tokens) that summed-with-a-long-passage to the
// target and got cited. Penalizing EACH side's distance from the target keeps
// both halves of a cited parallel substantive while staying budget-friendly.
const TARGET_CHUNK_TOKENS = 150;

const CHUNK_COLS = (alias: string) =>
  `${alias}.id, ${alias}.text_id, ${alias}.tradition, ${alias}.text_name, ${alias}.section,
   ${alias}.translator, ${alias}.body, ${alias}.token_count`;

/** Headline counts — the corpus at a glance. */
async function headline(): Promise<AtlasSnapshot['headline']> {
  const row = await one<{
    traditions: number; concepts: number; families: number;
    parallels_verified: number; parallels_proposed: number; contrasts: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM corpus.traditions)                                       AS traditions,
       (SELECT COUNT(*) FROM corpus.concepts)                                         AS concepts,
       (SELECT COUNT(*) FROM corpus.concept_families)                                 AS families,
       (SELECT COUNT(*) FROM corpus.edges WHERE edge_type='PARALLELS' AND tier='verified') AS parallels_verified,
       (SELECT COUNT(*) FROM corpus.edges WHERE edge_type='PARALLELS' AND tier='proposed') AS parallels_proposed,
       (SELECT COUNT(*) FROM corpus.edges WHERE edge_type='CONTRASTS')                AS contrasts`,
  );
  return {
    traditions: Number(row?.traditions ?? 0),
    concepts: Number(row?.concepts ?? 0),
    families: Number(row?.families ?? 0),
    parallelsVerified: Number(row?.parallels_verified ?? 0),
    parallelsProposed: Number(row?.parallels_proposed ?? 0),
    contrasts: Number(row?.contrasts ?? 0),
  };
}

/** Document-knowledge layer counts (v4): works, dossier coverage, summary nodes. */
async function documentLayer(): Promise<AtlasSnapshot['documentLayer']> {
  const row = await one<{
    works: number; dossiers: number; summaries_l1: number; summaries_l2: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM corpus.works)                          AS works,
       (SELECT COUNT(*) FROM corpus.work_dossiers)                  AS dossiers,
       (SELECT COUNT(*) FROM corpus.summary_nodes WHERE level = 1)  AS summaries_l1,
       (SELECT COUNT(*) FROM corpus.summary_nodes WHERE level = 2)  AS summaries_l2`,
  );
  return {
    works: Number(row?.works ?? 0),
    dossiers: Number(row?.dossiers ?? 0),
    summaryNodesL1: Number(row?.summaries_l1 ?? 0),
    summaryNodesL2: Number(row?.summaries_l2 ?? 0),
  };
}

/** Top cross-tradition pairs by verified-parallel count. */
async function traditionMatrix(limit = 15): Promise<AtlasSnapshot['traditionMatrix']> {
  const rows = await query<{ a: string; b: string; parallels: number }>(
    `WITH p AS (
       SELECT LEAST(cs.tradition, ct.tradition) AS a,
              GREATEST(cs.tradition, ct.tradition) AS b
       FROM corpus.edges e
       JOIN corpus.chunks cs ON cs.id = e.source
       JOIN corpus.chunks ct ON ct.id = e.target
       WHERE e.edge_type='PARALLELS' AND e.tier='verified' AND cs.tradition <> ct.tradition)
     SELECT a, b, COUNT(*)::int AS parallels
     FROM p GROUP BY a, b ORDER BY parallels DESC, a, b LIMIT $1`,
    [limit],
  );
  return rows.map(r => ({ a: r.a, b: r.b, parallels: Number(r.parallels) }));
}

/** Per-tradition centrality: raw degree, partner count, and per-100-chunk normalization. */
async function centrality(): Promise<AtlasSnapshot['centrality']> {
  const rows = await query<{
    tradition: string; chunks: number; parallel_degree: number;
    partner_traditions: number; per100: number;
  }>(
    `WITH p AS (
       SELECT cs.tradition AS a, ct.tradition AS b
       FROM corpus.edges e
       JOIN corpus.chunks cs ON cs.id = e.source
       JOIN corpus.chunks ct ON ct.id = e.target
       WHERE e.edge_type='PARALLELS' AND e.tier='verified'),
     u AS (SELECT a AS t, b AS o FROM p UNION ALL SELECT b, a FROM p),
     deg AS (
       SELECT t, COUNT(*)::int AS parallel_degree, COUNT(DISTINCT o)::int AS partner_traditions
       FROM u GROUP BY t),
     ch AS (SELECT tradition, COUNT(*)::int AS chunks FROM corpus.chunks GROUP BY tradition)
     SELECT ch.tradition,
            ch.chunks,
            COALESCE(deg.parallel_degree, 0)    AS parallel_degree,
            COALESCE(deg.partner_traditions, 0) AS partner_traditions,
            ROUND(100.0 * COALESCE(deg.parallel_degree,0) / NULLIF(ch.chunks,0), 1) AS per100
     FROM ch LEFT JOIN deg ON deg.t = ch.tradition
     ORDER BY parallel_degree DESC`,
  );
  return rows.map(r => ({
    tradition: r.tradition,
    chunks: Number(r.chunks),
    parallelDegree: Number(r.parallel_degree),
    partnerTraditions: Number(r.partner_traditions),
    parallelsPer100Chunks: Number(r.per100 ?? 0),
  }));
}

/** Concepts ranked by tradition-spread (EXPRESSES), situated in their family. */
async function bridgeConcepts(limit = 15): Promise<AtlasSnapshot['bridgeConcepts']> {
  const rows = await query<{ label: string; domain: string | null; family: string | null; traditions: number; mentions: number }>(
    `SELECT co.label, co.domain, cf.label AS family,
            COUNT(DISTINCT c.tradition)::int AS traditions,
            COUNT(*)::int AS mentions
     FROM corpus.edges e
     JOIN corpus.chunks c   ON c.id = e.source
     JOIN corpus.concepts co ON co.id = e.target
     LEFT JOIN corpus.concept_families cf ON cf.id = co.family_id
     WHERE e.edge_type='EXPRESSES'
     GROUP BY co.label, co.domain, cf.label
     ORDER BY traditions DESC, mentions DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(r => ({
    label: r.label, domain: r.domain, family: r.family,
    traditions: Number(r.traditions), mentions: Number(r.mentions),
  }));
}

/**
 * Concept families ranked by tradition-spread (EXPRESSES rolled up to the
 * family). domain comes from the family id namespace (e.g. "soteriology.x").
 */
async function familyBridges(limit = 15): Promise<AtlasSnapshot['familyBridges']> {
  const rows = await query<{ id: string; label: string; domain: string; traditions: number; concepts: number; mentions: number }>(
    `SELECT cf.id, cf.label, split_part(cf.id, '.', 1) AS domain,
            COUNT(DISTINCT ch.tradition)::int AS traditions,
            COUNT(DISTINCT c.id)::int        AS concepts,
            COUNT(*)::int                    AS mentions
     FROM corpus.edges e
     JOIN corpus.chunks ch          ON ch.id = e.source
     JOIN corpus.concepts c         ON c.id = e.target
     JOIN corpus.concept_families cf ON cf.id = c.family_id
     WHERE e.edge_type='EXPRESSES'
     GROUP BY cf.id, cf.label
     ORDER BY traditions DESC, mentions DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(r => ({
    id: r.id, label: r.label, domain: r.domain,
    traditions: Number(r.traditions), concepts: Number(r.concepts), mentions: Number(r.mentions),
  }));
}

/** The full domain → family → concept map, grouped from corpus.concepts. */
async function hierarchy(): Promise<AtlasSnapshot['hierarchy']> {
  const rows = await query<{ domain: string | null; family_id: string; family_label: string; concept_label: string }>(
    `SELECT c.domain, cf.id AS family_id, cf.label AS family_label, c.label AS concept_label
     FROM corpus.concepts c
     JOIN corpus.concept_families cf ON cf.id = c.family_id
     ORDER BY c.domain, cf.label, c.label`,
  );
  const domains = new Map<string, Map<string, { id: string; label: string; concepts: string[] }>>();
  for (const r of rows) {
    const domain = r.domain ?? 'unfiled';
    if (!domains.has(domain)) domains.set(domain, new Map());
    const fams = domains.get(domain)!;
    if (!fams.has(r.family_id)) fams.set(r.family_id, { id: r.family_id, label: r.family_label, concepts: [] });
    fams.get(r.family_id)!.concepts.push(r.concept_label);
  }
  return [...domains.entries()].map(([domain, fams]) => ({
    domain,
    families: [...fams.values()],
  }));
}

/** K exemplar verified parallels for a specific ordered tradition pair. */
async function exemplarsForPair(a: string, b: string, k: number): Promise<AtlasParallel[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${CHUNK_COLS('cs')},
            ct.id AS b_id, ct.text_id AS b_text_id, ct.tradition AS b_tradition, ct.text_name AS b_text_name,
            ct.section AS b_section, ct.translator AS b_translator, ct.body AS b_body,
            ct.token_count AS b_token_count, e.tier AS edge_tier
     FROM corpus.edges e
     JOIN corpus.chunks cs ON cs.id = e.source
     JOIN corpus.chunks ct ON ct.id = e.target
     WHERE e.edge_type='PARALLELS' AND e.tier='verified'
       AND ((cs.tradition=$1 AND ct.tradition=$2) OR (cs.tradition=$2 AND ct.tradition=$1))
     ORDER BY ABS(cs.token_count - ${TARGET_CHUNK_TOKENS}) + ABS(ct.token_count - ${TARGET_CHUNK_TOKENS}) ASC
     LIMIT $3`,
    [a, b, k],
  );
  return rows.map(r => ({
    a: chunkFrom(r, '', String(r.edge_tier)),
    b: chunkFrom(r, 'b_', String(r.edge_tier)),
  }));
}

/** Build an AtlasChunk from a prefixed result row. */
function chunkFrom(r: Record<string, unknown>, prefix: string, tier: string): AtlasChunk {
  return {
    id: String(r[`${prefix}id`]),
    text_id: String(r[`${prefix}text_id`]),
    tradition: String(r[`${prefix}tradition`]),
    text_name: String(r[`${prefix}text_name`]),
    section: String(r[`${prefix}section`]),
    translator: (r[`${prefix}translator`] as string | null) ?? null,
    tier,
    body: String(r[`${prefix}body`]),
    token_count: Number(r[`${prefix}token_count`] ?? 0),
  };
}

/** The 8 explicit CONTRASTS with their passages and curated annotations. */
async function contrasts(limit = 8): Promise<AtlasContrast[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${CHUNK_COLS('cs')},
            ct.id AS b_id, ct.text_id AS b_text_id, ct.tradition AS b_tradition, ct.text_name AS b_text_name,
            ct.section AS b_section, ct.translator AS b_translator, ct.body AS b_body,
            ct.token_count AS b_token_count, e.tier AS edge_tier, e.annotation AS annotation
     FROM corpus.edges e
     JOIN corpus.chunks cs ON cs.id = e.source
     JOIN corpus.chunks ct ON ct.id = e.target
     WHERE e.edge_type='CONTRASTS'
     ORDER BY ABS(cs.token_count - ${TARGET_CHUNK_TOKENS}) + ABS(ct.token_count - ${TARGET_CHUNK_TOKENS}) ASC
     LIMIT $1`,
    [limit],
  );
  return rows.map(r => ({
    a: chunkFrom(r, '', String(r.edge_tier)),
    b: chunkFrom(r, 'b_', String(r.edge_tier)),
    annotation: (r.annotation as string | null) ?? null,
  }));
}

/**
 * Dossier capsules for the works behind the given cited passages, deduped by
 * work. Same PK-shaped path as lib/dossier.ts (chunks.text_id → texts.work_id →
 * work_dossiers); the inner join drops undossiered works silently.
 */
async function dossierCapsules(textIds: string[]): Promise<AtlasDossierCapsule[]> {
  if (textIds.length === 0) return [];
  const rows = await query<{
    work_id: string; work_label: string; tradition: string;
    summary: string; context: string; themes: unknown; text_ids: string[];
  }>(
    `SELECT w.id AS work_id, w.label AS work_label, w.tradition,
            d.summary, d.context, d.themes,
            array_agg(DISTINCT t.id) AS text_ids
     FROM corpus.texts t
     JOIN corpus.works w         ON w.id = t.work_id
     JOIN corpus.work_dossiers d ON d.work_id = w.id
     WHERE t.id = ANY($1::text[])
     GROUP BY w.id, d.work_id
     ORDER BY work_label`,
    [textIds],
  );
  // themes is JSONB NOT NULL but not shape-constrained (same guard as
  // lib/dossier.ts): a malformed export must degrade, not crash the snapshot.
  const capsules = rows.map(r => ({
    ...r,
    themes: Array.isArray(r.themes) ? (r.themes as string[]) : [],
  }));
  // Resolve theme concept ids ('concept.cosmic_dualism') to display labels;
  // unresolvable ids fall back to the id itself.
  const themeIds = [...new Set(capsules.flatMap(c => c.themes))];
  if (themeIds.length > 0) {
    const labels = await query<{ id: string; label: string }>(
      `SELECT id, label FROM corpus.concepts WHERE id = ANY($1::text[])`,
      [themeIds],
    );
    const byId = new Map(labels.map(l => [l.id, l.label]));
    for (const c of capsules) c.themes = c.themes.map(t => byId.get(t) ?? t);
  }
  return capsules;
}

/**
 * Compute the full atlas snapshot. `generatedAt` is injected by the caller (pass
 * new Date().toISOString()) so the snapshot is deterministic under test.
 */
export async function computeAtlasSnapshot(generatedAt: string): Promise<AtlasSnapshot> {
  const meta = await one<{ value: string }>(
    `SELECT value FROM corpus.corpus_metadata WHERE key = 'schema_version'`,
  );

  const [head, docLayer, matrix, central, bridges, families, hier, contrastRows] = await Promise.all([
    headline(),
    documentLayer(),
    traditionMatrix(),
    centrality(),
    bridgeConcepts(),
    familyBridges(),
    hierarchy(),
    contrasts(),
  ]);

  // Long-range hard cases: only pairs that actually have verified parallels.
  const longRangeCases: AtlasSnapshot['longRangeCases'] = [];
  for (const [a, b] of LONG_RANGE_PAIRS) {
    const exemplars = await exemplarsForPair(a, b, EXEMPLARS_PER_CASE);
    if (exemplars.length === 0) continue;
    const cell = matrix.find(
      m => (m.a === a && m.b === b) || (m.a === b && m.b === a),
    );
    longRangeCases.push({ a, b, parallels: cell?.parallels ?? exemplars.length, exemplars });
  }

  // Capsules for every work behind a cited passage (exemplars + contrasts).
  const citedTextIds = new Set<string>();
  for (const lc of longRangeCases) for (const ex of lc.exemplars) {
    citedTextIds.add(ex.a.text_id);
    citedTextIds.add(ex.b.text_id);
  }
  for (const ct of contrastRows) {
    citedTextIds.add(ct.a.text_id);
    citedTextIds.add(ct.b.text_id);
  }
  const capsules = await dossierCapsules([...citedTextIds]);

  return {
    generatedAt,
    schemaVersion: meta?.value ?? 'unknown',
    headline: head,
    documentLayer: docLayer,
    traditionMatrix: matrix,
    centrality: central,
    bridgeConcepts: bridges,
    familyBridges: families,
    hierarchy: hier,
    longRangeCases,
    contrasts: contrastRows,
    dossierCapsules: capsules,
  };
}
