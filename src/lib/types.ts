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
