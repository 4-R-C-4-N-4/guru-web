/**
 * src/lib/history.ts
 *
 * Loads prior turns of a session as a flat ChatMessage[] for the model's
 * messages array. Within-session conversation continuity. Spec:
 * docs/conversation-continuity/BRD-conversation-continuity.md.
 */

import { query } from './db';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const DEFAULT_MAX_TURNS  = 6;     // 3 user/assistant pairs
const DEFAULT_MAX_TOKENS = 4_000;

/**
 * Fetch prior user/assistant pairs for a session, prune FIFO, return as a
 * flat message array ready to splice into a chat-completions request.
 *
 * Pair-atomic: never returns an orphan assistant at index 0. Rows with empty
 * `response_text` (errored streams) are skipped — replaying half-formed
 * responses confuses the model.
 *
 * Pruning is FIFO under both caps simultaneously; oldest pairs go first.
 * Long sessions silently drop earliest history; phase 4 introduces a smarter
 * window if needed.
 */
export async function loadSessionHistory(
  sessionId: string,
  opts: { maxTurns?: number; maxTokens?: number } = {},
): Promise<ChatMessage[]> {
  const maxTurns  = opts.maxTurns  ?? DEFAULT_MAX_TURNS;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  const rows = await query<{ query_text: string; response_text: string }>(
    `SELECT query_text, response_text
       FROM queries
      WHERE session_id = $1
      ORDER BY created_at ASC`,
    [sessionId],
  );

  const pairs: [ChatMessage, ChatMessage][] = [];
  for (const row of rows) {
    if (!row.response_text) continue;
    pairs.push([
      { role: 'user',      content: row.query_text },
      { role: 'assistant', content: row.response_text },
    ]);
  }

  // Cap by pair count first (maxTurns counts messages; 2 messages = 1 pair).
  const maxPairs = Math.floor(maxTurns / 2);
  while (pairs.length > maxPairs) pairs.shift();

  // Then cap by token budget; ~4 chars/token (matches estimateTokens in budget.ts).
  const charBudget = maxTokens * 4;
  let totalChars = pairs.reduce(
    (n, [u, a]) => n + u.content.length + a.content.length,
    0,
  );
  while (totalChars > charBudget && pairs.length > 0) {
    const [u, a] = pairs.shift()!;
    totalChars -= u.content.length + a.content.length;
  }

  return pairs.flat();
}
