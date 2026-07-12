/**
 * src/lib/chat-public.ts
 *
 * Public-side reads for shared chats (todo:47067537). Mirrors
 * blog-public.ts: visibility is gated at the query layer — the helper only
 * ever returns non-revoked shares, so no caller can accidentally render a
 * revoked one. The row is a self-contained snapshot (session_shares,
 * migration 015); nothing here touches sessions, queries, or the corpus.
 */

import { one } from './db';
import type { RetrievalScope } from './types';
import type { CitationTier } from './citations';

/** A citation frozen into the snapshot at share time — rich display
 *  fields plus the source chunk id (what a fork writes back into
 *  queries.chunks_used). */
export interface SharedCitation {
  id: string;
  tradition: string;
  text: string;
  section: string;
  tier: CitationTier;
}

export interface SharedMessage {
  query_text: string;
  response_text: string;
  created_at: string;
  citations: SharedCitation[];
}

export interface PublicShare {
  id: string;
  slug: string;
  title: string | null;
  messages: SharedMessage[];
  voice: string;
  mode: 'chat' | 'study';
  study_text_id: string | null;
  retrieval_scope: RetrievalScope;
  created_at: string;
}

/**
 * A share by public slug, or null when the slug is unknown OR the share
 * has been revoked — both 404 identically on the public side, leaking
 * nothing about which it was.
 */
export async function getShareBySlug(slug: string): Promise<PublicShare | null> {
  const row = await one<PublicShare>(
    `SELECT id, slug, title, messages, voice, mode, study_text_id,
            retrieval_scope, created_at
       FROM session_shares
      WHERE slug = $1 AND revoked_at IS NULL`,
    [slug],
  );
  if (!row) return null;
  return {
    ...row,
    messages: Array.isArray(row.messages) ? row.messages : [],
  };
}
