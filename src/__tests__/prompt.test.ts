/**
 * src/__tests__/prompt.test.ts
 * Unit tests for prompt assembly and system prompt structure.
 */

import { describe, it, expect } from 'vitest';
import { buildPrompt, getSystemPrompt, DEFAULT_VOICE, isVoiceSlug } from '@/lib/prompt';
import type { RetrievedChunk, UserPreferences } from '@/lib/types';

const DEFAULT_PREFS: UserPreferences = {
  scopeMode: 'all',
  blockedTraditions: [],
  blockedTexts: [],
  whitelistedTraditions: [],
  whitelistedTexts: [],
  preferredModel: null,
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

describe('getSystemPrompt', () => {
  const scholarPrompt = getSystemPrompt('scholar');

  it('contains key scholarly constraints', () => {
    expect(scholarPrompt).toContain('Guru');
    expect(scholarPrompt).toContain('CITATIONS');
    expect(scholarPrompt).toContain('verified');
  });

  it('preserves the scholar identity opening', () => {
    expect(scholarPrompt).toContain('You are Guru, a scholarly assistant specialising in cross-tradition esoteric research.');
    expect(scholarPrompt).toContain('rigorous academic care');
  });

  it('grounds claims and forbids invented citations', () => {
    expect(scholarPrompt).toContain('Every substantive claim about a tradition');
    expect(scholarPrompt).toContain('Do not invent quotations');
    expect(scholarPrompt).toContain('Avoid false equivalences');
  });

  it('signals register shifts with concrete phrase examples', () => {
    expect(scholarPrompt).toContain('the pattern here suggests');
    expect(scholarPrompt).toContain('outside the passages here');
    expect(scholarPrompt).toContain('name it by title');
  });

  it('requires a followup hook before the citation block', () => {
    expect(scholarPrompt).toContain('End each reply with a beat that opens the next turn');
    expect(scholarPrompt).toContain('This is not "let me know if you have more questions"');
    expect(scholarPrompt).toContain('The closing beat is the last\n  beat of your prose, immediately before the CITATIONS block.');
  });

  it('locks the citation format', () => {
    expect(scholarPrompt).toMatch(/CITATIONS:\n\[TRADITION \| TEXT \| SECTION \| TIER: verified\/proposed\/inferred\]\n"optional short quote"$/);
  });

  it('separates voice overlay from CORE_RULES with a blank line', () => {
    // Composition contract: ${voice}\n\n${rules}. The identity opening
    // ends with "rigorous academic care." and CORE_RULES begins with
    // "You will receive source passages". The double-newline separator
    // must sit between them.
    expect(scholarPrompt).toContain('rigorous academic care.\n\nYou will receive source passages');
  });

  it('DEFAULT_VOICE composition equals scholar composition', () => {
    expect(getSystemPrompt(DEFAULT_VOICE)).toBe(scholarPrompt);
  });
});

describe('isVoiceSlug', () => {
  it('accepts shipped slugs', () => {
    expect(isVoiceSlug('scholar')).toBe(true);
  });

  it('rejects unknown slugs', () => {
    expect(isVoiceSlug('woowoo')).toBe(false); // ticket 3 adds this
    expect(isVoiceSlug('')).toBe(false);
    expect(isVoiceSlug('SCHOLAR')).toBe(false); // case-sensitive
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

  it('reservedExtra shrinks the chunk budget so fewer chunks fit', () => {
    // Pile on enough chunks that the budget genuinely binds.
    const chunks = Array.from({ length: 30 }, (_, i) =>
      makeChunk(`c${i}`, 'vedanta', 'verified')
    );
    const baseline = buildPrompt('atman', chunks, DEFAULT_PREFS, 'free');
    // Free available is ~5632 tokens; reserve enough that <30 chunks fit.
    const squeezed = buildPrompt('atman', chunks, DEFAULT_PREFS, 'free', 5_400);
    const baselineCount = (baseline.match(/^\[\d+\]/gm) ?? []).length;
    const squeezedCount = (squeezed.match(/^\[\d+\]/gm) ?? []).length;
    expect(squeezedCount).toBeLessThan(baselineCount);
  });
});
