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
}

export interface User {
  id: string;
  email: string;
  tier: 'free' | 'pro';
  stripe_customer_id: string | null;
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
  created_at: string;
}
