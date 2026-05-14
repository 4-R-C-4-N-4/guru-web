/**
 * src/__tests__/prefs.test.ts
 * Unit tests for the user_preferences load/save shape.
 *
 * Mocks the DB layer; verifies the lib/prefs.ts mapping between
 * snake_case row columns and camelCase UserPreferences fields.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  one:  vi.fn(),
  exec: vi.fn(),
}));

import * as db from '@/lib/db';
import { loadPreferences, savePreferences } from '@/lib/prefs';

const mockOne  = db.one  as MockedFunction<typeof db.one>;
const mockExec = db.exec as MockedFunction<typeof db.exec>;

const ROW_DEFAULTS = {
  scope_mode: 'all',
  blocked_traditions: [],
  blocked_texts: [],
  whitelisted_traditions: [],
  whitelisted_texts: [],
  preferred_model: null,
  preferred_voice: 'scholar',
};

beforeEach(() => {
  mockOne.mockReset();
  mockExec.mockReset();
});

describe('loadPreferences', () => {
  it('returns the default preferences shape when no row exists', async () => {
    mockOne.mockResolvedValueOnce(null);
    const prefs = await loadPreferences('user_unknown');
    expect(prefs.preferredVoice).toBe('scholar');
    expect(prefs.preferredModel).toBeNull();
    expect(prefs.scopeMode).toBe('all');
  });

  it('returns preferred_voice from the row when present', async () => {
    mockOne.mockResolvedValueOnce({ ...ROW_DEFAULTS, preferred_voice: 'woowoo' });
    const prefs = await loadPreferences('user_1');
    expect(prefs.preferredVoice).toBe('woowoo');
  });

  it('falls back to scholar for an unknown voice slug in storage', async () => {
    // Defensive guard: the migration's NOT NULL DEFAULT 'scholar' makes
    // this near-impossible, but loadPreferences should not propagate an
    // invalid slug to getSystemPrompt() if it ever appears.
    mockOne.mockResolvedValueOnce({ ...ROW_DEFAULTS, preferred_voice: 'sage-of-atlantis' });
    const prefs = await loadPreferences('user_2');
    expect(prefs.preferredVoice).toBe('scholar');
  });

  it('includes preferred_voice in the SELECT list', async () => {
    mockOne.mockResolvedValueOnce({ ...ROW_DEFAULTS });
    await loadPreferences('user_1');
    const [sql] = mockOne.mock.calls[0] ?? [];
    expect(sql).toContain('preferred_voice');
  });
});

describe('savePreferences', () => {
  it('writes preferred_voice into the INSERT', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    await savePreferences('user_3', {
      scopeMode: 'all',
      blockedTraditions: [],
      blockedTexts: [],
      whitelistedTraditions: [],
      whitelistedTexts: [],
      preferredModel: null,
      preferredVoice: 'woowoo',
    });
    const [sql, params] = mockExec.mock.calls[0] ?? [];
    expect(sql).toContain('preferred_voice');
    expect(params).toContain('woowoo');
  });

  it('writes preferred_voice on UPDATE conflict path', async () => {
    mockExec.mockResolvedValueOnce(undefined);
    await savePreferences('user_4', {
      scopeMode: 'all',
      blockedTraditions: [],
      blockedTexts: [],
      whitelistedTraditions: [],
      whitelistedTexts: [],
      preferredModel: null,
      preferredVoice: 'scholar',
    });
    const [sql] = mockExec.mock.calls[0] ?? [];
    expect(sql).toMatch(/preferred_voice\s*=\s*EXCLUDED\.preferred_voice/);
  });
});
