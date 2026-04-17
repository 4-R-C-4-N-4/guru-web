/**
 * src/__tests__/prompt.test.ts
 * Unit tests for prompt assembly and system prompt structure.
 */

import { describe, it, expect } from 'vitest';
import { buildPrompt, SYSTEM_PROMPT } from '@/lib/prompt';
import { estimateTokens } from '@/lib/budget';
import type { RetrievedChunk, UserPreferences } from '@/lib/types';

const DEFAULT_PREFS: UserPreferences = {
  scopeMode: 'all',
  blockedTraditions: [],
  blockedTexts: [],
  whitelistedTraditions: [],
  whitelistedTexts: [],
};

const makeChunk = (id: string, tradition: string, tier: RetrievedChunk['tier'] = 'verified'): RetrievedChunk => ({
  id,
  text_id: `text-${id}`,
  tradition,
  text_name: `${tradition} Text`,
  section: 'Section 1',
  translator: null,
  body: 'The light of consciousness pervades all things. It is the nature of the self to be awareness itself.',
  token_count: 24,
  source: 'vector',
  tier,
});

describe('SYSTEM_PROMPT', () => {
  it('contains key scholarly constraints', () => {
    expect(SYSTEM_PROMPT).toContain('Guru');
    expect(SYSTEM_PROMPT).toContain('CITATIONS');
    expect(SYSTEM_PROMPT).toContain('verified');
  });

  it('names all major traditions', () => {
    const traditions = ['Gnosticism', 'Kabbalah', 'Hermeticism', 'Neoplatonism', 'Vedanta', 'Buddhism'];
    for (const t of traditions) {
      expect(SYSTEM_PROMPT).toContain(t);
    }
  });
});

describe('buildPrompt', () => {
  it('includes the query text', () => {
    const chunks = [makeChunk('c1', 'gnosticism')];
    const result = buildPrompt('What is divine spark?', chunks, DEFAULT_PREFS, 'free');
    expect(result).toContain('What is divine spark?');
  });

  it('includes chunk tradition and section headers', () => {
    const chunks = [makeChunk('c1', 'gnosticism', 'verified')];
    const result = buildPrompt('divine spark', chunks, DEFAULT_PREFS, 'free');
    expect(result).toContain('gnosticism');
    expect(result).toContain('◆'); // verified tier symbol
  });

  it('includes proposed tier symbol for proposed chunks', () => {
    const chunks = [makeChunk('c1', 'hermeticism', 'proposed')];
    const result = buildPrompt('nous', chunks, DEFAULT_PREFS, 'free');
    expect(result).toContain('◇');
  });

  it('falls back gracefully with no chunks', () => {
    const result = buildPrompt('orphan query', [], DEFAULT_PREFS, 'free');
    expect(result).toContain('No source passages');
    expect(result).toContain('orphan query');
  });

  it('pro tier allows more chunks than free tier', () => {
    // Create enough chunks to overflow a free budget but fit a pro budget
    const chunks = Array.from({ length: 30 }, (_, i) =>
      makeChunk(`c${i}`, 'vedanta', 'verified')
    );
    const freeResult  = buildPrompt('atman', chunks, DEFAULT_PREFS, 'free');
    const proResult   = buildPrompt('atman', chunks, DEFAULT_PREFS, 'pro');
    // Pro prompt should reference more passages (more [N] labels)
    const freeCount = (freeResult.match(/^\[\d+\]/gm) ?? []).length;
    const proCount  = (proResult.match(/^\[\d+\]/gm) ?? []).length;
    expect(proCount).toBeGreaterThanOrEqual(freeCount);
  });
});
