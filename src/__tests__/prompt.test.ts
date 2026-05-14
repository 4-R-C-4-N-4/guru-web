/**
 * src/__tests__/prompt.test.ts
 * Unit tests for prompt assembly and system prompt structure.
 */

import { describe, it, expect } from 'vitest';
import { buildPrompt, SYSTEM_PROMPT } from '@/lib/prompt';
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

describe('SYSTEM_PROMPT', () => {
  it('contains key scholarly constraints', () => {
    expect(SYSTEM_PROMPT).toContain('Guru');
    expect(SYSTEM_PROMPT).toContain('CITATIONS');
    expect(SYSTEM_PROMPT).toContain('verified');
  });

  it('preserves the scholar identity opening', () => {
    expect(SYSTEM_PROMPT).toContain('You are Guru, a scholarly assistant specialising in cross-tradition esoteric research.');
    expect(SYSTEM_PROMPT).toContain('rigorous academic care');
  });

  it('grounds claims and forbids invented citations', () => {
    expect(SYSTEM_PROMPT).toContain('Every substantive claim about a tradition');
    expect(SYSTEM_PROMPT).toContain('Do not invent quotations');
    expect(SYSTEM_PROMPT).toContain('Avoid false equivalences');
  });

  it('signals register shifts with concrete phrase examples', () => {
    expect(SYSTEM_PROMPT).toContain('the pattern here suggests');
    expect(SYSTEM_PROMPT).toContain('outside the passages here');
    expect(SYSTEM_PROMPT).toContain('name it by title');
  });

  it('requires a followup hook before the citation block', () => {
    expect(SYSTEM_PROMPT).toContain('End each reply with a beat that opens the next turn');
    expect(SYSTEM_PROMPT).toContain('This is not "let me know if you have more questions"');
    expect(SYSTEM_PROMPT).toContain('The closing beat is the last\n  beat of your prose, immediately before the CITATIONS block.');
  });

  it('locks the citation format', () => {
    expect(SYSTEM_PROMPT).toMatch(/CITATIONS:\n\[TRADITION \| TEXT \| SECTION \| TIER: verified\/proposed\/inferred\]\n"optional short quote"$/);
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
