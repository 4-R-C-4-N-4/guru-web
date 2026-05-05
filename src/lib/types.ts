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

export interface RetrievedChunk extends Chunk {
  distance?: number;
  source: 'vector' | 'graph';
  tier?: 'verified' | 'proposed' | 'inferred';
}

export interface Citation {
  tradition: string;
  text: string;
  section: string;
  quote?: string;
  tier: 'verified' | 'proposed' | 'inferred';
}

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
}

export interface User {
  id: string;
  email: string;
  tier: 'free' | 'pro';
  stripe_customer_id: string | null;
  currency: string;
}

export interface Session {
  id: string;
  title: string | null;
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
