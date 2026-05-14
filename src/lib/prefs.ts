/**
 * src/lib/prefs.ts
 *
 * UserPreferences load and save — reads/writes the user_preferences table.
 */

import { one, exec } from './db';
import type { UserPreferences } from './types';

const DEFAULT_PREFS: UserPreferences = {
  scopeMode: 'all',
  blockedTraditions: [],
  blockedTexts: [],
  whitelistedTraditions: [],
  whitelistedTexts: [],
  preferredModel: null,
  preferredVoice: 'scholar',
};

export async function loadPreferences(userId: string): Promise<UserPreferences> {
  const row = await one<{
    scope_mode: string;
    blocked_traditions: string[];
    blocked_texts: string[];
    whitelisted_traditions: string[];
    whitelisted_texts: string[];
    preferred_model: string | null;
    preferred_voice: string;
  }>(
    `SELECT scope_mode, blocked_traditions, blocked_texts,
            whitelisted_traditions, whitelisted_texts,
            preferred_model, preferred_voice
     FROM user_preferences
     WHERE user_id = $1`,
    [userId]
  );

  if (!row) return { ...DEFAULT_PREFS };

  // Defensive: if a future deployment somehow lands a value that isn't
  // a known voice slug, fall back to the default rather than letting an
  // invalid slug propagate into getSystemPrompt(). The migration's
  // NOT NULL DEFAULT 'scholar' makes this near-impossible, but the
  // belt-and-braces is cheap and keeps query-time crashes off the table.
  const storedVoice = row.preferred_voice;
  const preferredVoice: UserPreferences['preferredVoice'] =
    storedVoice === 'scholar' || storedVoice === 'woowoo' ? storedVoice : 'scholar';

  return {
    scopeMode:             (row.scope_mode as UserPreferences['scopeMode']) ?? 'all',
    blockedTraditions:     row.blocked_traditions     ?? [],
    blockedTexts:          row.blocked_texts          ?? [],
    whitelistedTraditions: row.whitelisted_traditions ?? [],
    whitelistedTexts:      row.whitelisted_texts      ?? [],
    preferredModel:        row.preferred_model        ?? null,
    preferredVoice,
  };
}

export async function savePreferences(
  userId: string,
  prefs: UserPreferences
): Promise<void> {
  await exec(
    `INSERT INTO user_preferences
       (user_id, scope_mode, blocked_traditions, blocked_texts,
        whitelisted_traditions, whitelisted_texts, preferred_model,
        preferred_voice, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (user_id) DO UPDATE SET
       scope_mode             = EXCLUDED.scope_mode,
       blocked_traditions     = EXCLUDED.blocked_traditions,
       blocked_texts          = EXCLUDED.blocked_texts,
       whitelisted_traditions = EXCLUDED.whitelisted_traditions,
       whitelisted_texts      = EXCLUDED.whitelisted_texts,
       preferred_model        = EXCLUDED.preferred_model,
       preferred_voice        = EXCLUDED.preferred_voice,
       updated_at             = now()`,
    [
      userId,
      prefs.scopeMode,
      prefs.blockedTraditions,
      prefs.blockedTexts,
      prefs.whitelistedTraditions,
      prefs.whitelistedTexts,
      prefs.preferredModel,
      prefs.preferredVoice,
    ]
  );
}
