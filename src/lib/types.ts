/**
 * src/lib/types.ts
 * Shared domain types used across lib modules and API routes.
 */

export interface Chunk {
  id: string;
  text_id: string;
  tradition: string;
  text_name: string;
  section: string;
  translator: string | null;
  body: string;
  token_count: number;
}

/**
 * Query-expansion match tier (todo:30dca55e §5). A query token can match a
 * concept directly, a family (→ all its concepts), or a domain (→ all concepts
 * under it). This is a SEPARATE axis from the EXPRESSES edge tier
 * (verified/proposed/inferred): match tier weights *how a concept was reached
 * from the query*, edge tier weights confidence in the chunk→concept link.
 */
export type MatchTier = 'concept' | 'family' | 'domain';

/** One concept surfaced by extractConcepts, tagged with how it was matched. */
export interface ConceptMatch {
  conceptId: string;
  matchTier: MatchTier;
}

/**
 * One family/domain match that fanned a query out into multiple concepts
 * (todo:9d2ad427 §8) — the query-expansion transparency signal shown to the
 * user ("matched Cosmology → 7 concepts"). Concept-tier matches are 1:1 and
 * intentionally excluded; only genuine expansions are surfaced.
 */
export interface QueryExpansion {
  tier: 'family' | 'domain';
  label: string;
  conceptCount: number;
}

export interface RetrievedChunk extends Chunk {
  distance?: number;
  source: 'vector' | 'graph' | 'lexical' | 'summary';
  tier?: 'verified' | 'proposed' | 'inferred' | 'summary';
  /**
   * Raw Postgres `ts_rank` carried by lexical-leg chunks (todo:af69f5e5): the
   * full-text relevance of this chunk's body against the query. Unbounded and
   * corpus-relative, so the reranker normalises it to [0,1] before applying
   * LEXICAL_WEIGHT. Undefined on vector/graph chunks. Internal scoring signal —
   * not serialised by existing routes.
   */
  lexRank?: number;
  /**
   * Query-expansion match weight carried by graph-leg chunks (todo:30dca55e §6):
   * the MATCH_TIER_WEIGHTS value of the strongest tier any reachable concept
   * expressing this chunk was matched at. Undefined on vector-leg chunks, where
   * ranking treats it as 1.0 (no expansion). Internal scoring signal — not
   * serialised by existing routes.
   */
  conceptMatchWeight?: number;
  /**
   * Set on the passage the user was reading when they clicked "Ask guru about
   * this passage" (todo:76219c57). The query route injects that chunk ahead of
   * retrieval results and formatChunk marks it in the prompt. Internal signal —
   * not serialised by existing routes.
   */
  pinned?: boolean;
}

/**
 * Read-only hierarchy view shapes for the browse / query-expansion UI
 * (todo:30dca55e §7, §8). Family/domain fields are optional so existing
 * concept-free DTOs and older clients are unaffected.
 */
export interface ConceptView {
  id: string;
  label: string;
  definition: string | null;
  family_id?: string | null;
  family_label?: string | null;
  domain?: string | null;
}

export interface FamilyView {
  id: string;
  label: string;
  definition: string;
  domain: string; // parent domain id
  concepts: ConceptView[];
}

export interface DomainView {
  id: string;
  label: string;
  definition: string;
  families: FamilyView[];
}

export interface Citation {
  tradition: string;
  text: string;
  section: string;
  quote?: string;
}

/**
 * Chat voice slug. The voice catalog lives in src/lib/prompt.ts
 * (VOICE_OVERLAY + isVoiceSlug). Spec: BRD-chat-voice.md §3.
 */
export type VoiceSlug = 'scholar' | 'woowoo';

export interface UserPreferences {
  scopeMode: 'all' | 'whitelist' | 'blacklist';
  blockedTraditions: string[];
  blockedTexts: string[];
  whitelistedTraditions: string[];
  whitelistedTexts: string[];
  /**
   * Curated-picker slug (deepseek | xai | anthropic | openai) or null
   * to mean "use the tier default." Only consulted for pro tier; free
   * is always pinned. Validated against CURATED_MODELS at write time
   * via /api/preferences. Spec: BRD-model-selection.md §5.1, §6.1.
   */
  preferredModel: string | null;
  /**
   * User's default voice for *new* sessions. Snapshotted onto
   * sessions.voice at creation time (ticket 5). Free users always
   * resolve to 'scholar' at query time regardless of what's stored.
   * Validated via isVoiceSlug() at /api/preferences PUT.
   * Spec: BRD-chat-voice.md §5.1, IMPL §4.
   */
  preferredVoice: VoiceSlug;
}

/**
 * The retrieval-scoping subset of UserPreferences — what
 * sessions.scope_override (migration 015) freezes onto a session forked
 * from a public share, so the fork keeps retrieving under the scope the
 * shared conversation was held under. Deliberately excludes
 * preferredModel/preferredVoice: those stay live (voice has its own
 * per-session snapshot in sessions.voice).
 * Spec: todo:36421ff5.
 */
export type RetrievalScope = Pick<
  UserPreferences,
  | 'scopeMode'
  | 'blockedTraditions'
  | 'blockedTexts'
  | 'whitelistedTraditions'
  | 'whitelistedTexts'
>;

/** Billing-health flag (todo:33d44563). Tracks Stripe's retry state
 *  independent of tier so a paying user with a temporary card decline
 *  keeps Pro access during Stripe's smart-retry window while seeing a
 *  banner prompting them to update their card.
 *    null        → billing healthy or N/A
 *    'past_due'  → most recent invoice failed; retry pending
 */
export type PaymentState = 'past_due' | null;

export interface User {
  id: string;
  email: string;
  tier: 'free' | 'pro';
  stripe_customer_id: string | null;
  payment_state: PaymentState;
}

export interface Session {
  id: string;
  title: string | null;
  mode: 'chat' | 'study';
  study_text_id: string | null;
  /** Resolved work label for the history list badge; null for chat sessions
   *  and stale pins. Only populated by GET /api/sessions. */
  study_work_label?: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueryRecord {
  id: string;
  query_text: string;
  response_text: string;
  chunks_used: string[];
  model_used: string;
  /** Token + cost columns from queries; nullable on rows that
   *  pre-date the cost-tracking migration or where the usage chunk
   *  never arrived (truncated stream). Surfaced in the chat view's
   *  per-response attribution line (model-selection BRD §7.4). */
  input_tokens?:  number | null;
  output_tokens?: number | null;
  cost_usd?:      number | null;
  created_at: string;
}

/**
 * A work's study dossier (schema v4 work_dossiers; summary-phase-w.md §W4).
 * `themes` arrives as concept ids from the corpus; the query route resolves
 * them to display labels before prompt assembly where possible.
 */
export interface WorkDossier {
  work_id: string;
  work_label: string;
  summary: string;
  context: string;
  structure: { section_span: string; title: string; synopsis?: string }[];
  key_figures: { name: string; role?: string; gloss?: string }[];
  key_terms: { term: string; transliteration?: string | null; gloss?: string }[];
  themes: string[];
  reading_notes: string | null;
}
