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
};

export async function loadPreferences(userId: string): Promise<UserPreferences> {
  const row = await one<{
    scope_mode: string;
    blocked_traditions: string[];
    blocked_texts: string[];
    whitelisted_traditions: string[];
    whitelisted_texts: string[];
  }>(
    `SELECT scope_mode, blocked_traditions, blocked_texts,
            whitelisted_traditions, whitelisted_texts
     FROM user_preferences
     WHERE user_id = $1`,
    [userId]
  );

  if (!row) return { ...DEFAULT_PREFS };

  return {
    scopeMode:             (row.scope_mode as UserPreferences['scopeMode']) ?? 'all',
    blockedTraditions:     row.blocked_traditions     ?? [],
    blockedTexts:          row.blocked_texts          ?? [],
    whitelistedTraditions: row.whitelisted_traditions ?? [],
    whitelistedTexts:      row.whitelisted_texts      ?? [],
  };
}

export async function savePreferences(
  userId: string,
  prefs: UserPreferences
): Promise<void> {
  await exec(
    `INSERT INTO user_preferences
       (user_id, scope_mode, blocked_traditions, blocked_texts,
        whitelisted_traditions, whitelisted_texts, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       scope_mode             = EXCLUDED.scope_mode,
       blocked_traditions     = EXCLUDED.blocked_traditions,
       blocked_texts          = EXCLUDED.blocked_texts,
       whitelisted_traditions = EXCLUDED.whitelisted_traditions,
       whitelisted_texts      = EXCLUDED.whitelisted_texts,
       updated_at             = now()`,
    [
      userId,
      prefs.scopeMode,
      prefs.blockedTraditions,
      prefs.blockedTexts,
      prefs.whitelistedTraditions,
      prefs.whitelistedTexts,
    ]
  );
}
