/**
 * src/__tests__/prompt.test.ts
 * Unit tests for prompt assembly and system prompt structure.
 */

import { describe, it, expect } from 'vitest';
import { buildPrompt, buildBlogPrompt, buildBlogPromptFromTopic, getBlogSystemPrompt, getSystemPrompt, DEFAULT_VOICE, isVoiceSlug } from '@/lib/prompt';
import type { RetrievedChunk, UserPreferences } from '@/lib/types';

const DEFAULT_PREFS: UserPreferences = {
  scopeMode: 'all',
  blockedTraditions: [],
  blockedTexts: [],
  whitelistedTraditions: [],
  whitelistedTexts: [],
  preferredModel: null,
  preferredVoice: 'scholar',
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
    expect(scholarPrompt).toMatch(/CITATIONS:\n\[TRADITION \| TEXT \| SECTION \| TIER: verified\/proposed\/inferred\/summary\]\n"optional short quote"$/);
  });

  it('separates voice overlay from CORE_RULES with a blank line', () => {
    // Composition contract: ${voice}\n\n${rules}. The scholar overlay's
    // last line ends with "rigorous academic care." and CORE_RULES opens
    // with the tradition list. The double-newline separator must sit
    // between them.
    expect(scholarPrompt).toContain('rigorous academic care.\n\nThe traditions in scope are');
  });

  it('DEFAULT_VOICE composition equals scholar composition', () => {
    expect(getSystemPrompt(DEFAULT_VOICE)).toBe(scholarPrompt);
  });
});

describe('isVoiceSlug', () => {
  it('accepts shipped slugs', () => {
    expect(isVoiceSlug('scholar')).toBe(true);
    expect(isVoiceSlug('woowoo')).toBe(true);
  });

  it('rejects unknown slugs', () => {
    expect(isVoiceSlug('')).toBe(false);
    expect(isVoiceSlug('SCHOLAR')).toBe(false); // case-sensitive
    expect(isVoiceSlug('terse')).toBe(false);   // plausible future voice, not yet shipped
  });
});

describe('getSystemPrompt(woowoo)', () => {
  const woowooPrompt = getSystemPrompt('woowoo');
  const scholarPrompt = getSystemPrompt('scholar');

  it('uses the woowoo identity opening, not the scholar one', () => {
    expect(woowooPrompt).toContain('alive to the material');
    expect(woowooPrompt).not.toContain('rigorous academic care');
    expect(woowooPrompt).not.toContain('scholarly assistant specialising');
  });

  it('carries the emphatic / mystical register', () => {
    expect(woowooPrompt).toContain('emphatic about what the traditions are reaching for');
    expect(woowooPrompt).toContain('carry that conviction');
    expect(woowooPrompt).toContain('Lyrical, mystical, and evocative language is welcome');
  });

  it('does not inherit "avoid vague spiritualism" — cut in todo:9e1f697c followup', () => {
    // Operator decision: the rule was suppressing woowoo without earning
    // its grounding-keep. Both voices now compose without it.
    expect(woowooPrompt).not.toContain('Avoid vague spiritualism');
    expect(scholarPrompt).not.toContain('Avoid vague spiritualism');
  });

  it('positions the model as cooperative, not corrective', () => {
    expect(woowooPrompt).toContain('serves the user\'s seeking');
    expect(woowooPrompt).toContain('walk into it with them');
    expect(woowooPrompt).toContain('not stand apart from the question as a corrective');
  });

  it('includes the launchpad-not-ceiling framing', () => {
    expect(woowooPrompt).toContain('launchpad, not your ceiling');
    expect(woowooPrompt).toContain('distinctive move');
    expect(woowooPrompt).toContain('wanting to keep going');
  });

  it('shares CORE_RULES with the scholar voice', () => {
    // The whole point of layering: the rule contract is invariant across voices.
    expect(woowooPrompt).toContain('Every substantive claim about a tradition');
    expect(woowooPrompt).toContain('Do not invent quotations');
    expect(woowooPrompt).toContain('Avoid false equivalences');
    expect(woowooPrompt).toContain('End each reply with a beat that opens the next turn');
    expect(woowooPrompt).toMatch(/CITATIONS:\n\[TRADITION \| TEXT \| SECTION \| TIER: verified\/proposed\/inferred\/summary\]\n"optional short quote"$/);
  });

  it('differs from scholar only in the overlay', () => {
    // Both should end with the same CITATIONS block (proves the shared CORE_RULES tail).
    const tail = 'Citation format (after your main response):\nCITATIONS:\n[TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred/summary]\n"optional short quote"';
    expect(woowooPrompt.endsWith(tail)).toBe(true);
    expect(scholarPrompt.endsWith(tail)).toBe(true);
  });
});

describe('CORE_RULES (shared content)', () => {
  it('lists the in-scope traditions for every voice', () => {
    // Tradition list lives in CORE_RULES so it's never out of sync between
    // voices. Spot-check a representative subset rather than the full list.
    const traditions = [
      'Buddhism',
      'Christian Mysticism',
      'Hermeticism',
      'Jewish Mysticism',
      'Neoplatonism',
      'Taoism',
      'Zoroastrianism',
    ];
    for (const voice of ['scholar', 'woowoo'] as const) {
      const composed = getSystemPrompt(voice);
      for (const t of traditions) {
        expect(composed).toContain(t);
      }
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

  // Ask-about-this-passage pin (todo:76219c57): the injected chunk is marked
  // in its header so the model anchors on it instead of treating it as one
  // candidate among fifteen. Unpinned chunks must stay marker-free.
  it('marks a pinned chunk as the passage the user is reading', () => {
    const pinned = { ...makeChunk('c1', 'greek_mystery'), pinned: true };
    const result = buildPrompt('what does this mean?', [pinned, makeChunk('c2', 'taoism')], DEFAULT_PREFS, 'free');
    expect(result).toContain('THE PASSAGE THE USER IS READING');
    const lines = result.split('\n');
    expect(lines.filter(l => l.includes('THE PASSAGE THE USER IS READING'))).toHaveLength(1);
    expect(lines.find(l => l.startsWith('[1]'))).toContain('THE PASSAGE THE USER IS READING');
    expect(lines.find(l => l.startsWith('[2]'))).not.toContain('THE PASSAGE THE USER IS READING');
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

describe('getBlogSystemPrompt', () => {
  const blogPrompt = getBlogSystemPrompt();

  it('keeps the grounding contract from CORE_RULES', () => {
    expect(blogPrompt).toContain('Every substantive claim about a tradition');
    expect(blogPrompt).toContain('Do not invent quotations');
    expect(blogPrompt).toContain('family resemblance');
  });

  it('carries the parseable TITLE / DEK / CITATIONS contract', () => {
    expect(blogPrompt).toContain('TITLE:');
    expect(blogPrompt).toContain('DEK:');
    expect(blogPrompt).toMatch(/CITATIONS:\n\[TRADITION \| TEXT \| SECTION \| TIER: verified\/proposed\/inferred\/summary\]/);
  });

  it('uses essay shape, not the chat single-turn closer', () => {
    // The blog rules must NOT inherit the chat closer that "opens the next turn".
    expect(blogPrompt).not.toContain('opens the next turn');
    expect(blogPrompt).toContain('Close with a thought that lands');
  });

  it('is the essayist voice, not a chat voice', () => {
    expect(blogPrompt).toContain('comparative-religion essayist');
    expect(blogPrompt).not.toContain('You are Guru');
  });
});

describe('buildBlogPrompt', () => {
  it('names both concepts and the angle in the essay brief', () => {
    const chunks = [makeChunk('c1', 'hermeticism'), makeChunk('c2', 'taoism')];
    const result = buildBlogPrompt(
      ['emanation', 'the uncarved block'],
      ['flowing-forth of the One', 'undifferentiated potential'],
      'both resist the idea of a made world',
      chunks,
    );
    expect(result).toContain('emanation');
    expect(result).toContain('the uncarved block');
    expect(result).toContain('both resist the idea of a made world');
    expect(result).toContain('SOURCE PASSAGES');
  });

  it('omits the angle line when no angle is given', () => {
    const chunks = [makeChunk('c1', 'gnosticism')];
    const result = buildBlogPrompt(['logos', 'tao'], [], null, chunks);
    expect(result).not.toContain('Angle to pursue');
    expect(result).toContain('logos');
    expect(result).toContain('tao');
  });

  it('drops chunks when the budget is tight', () => {
    // Each chunk is one long, period-free sentence (~1000 tokens) that
    // compression cannot shrink below itself, so 100 of them (~100k
    // tokens) must overflow the pro window (~30k) and the budget binds.
    const bigBody = 'the One overflows into being without diminishing '.repeat(80).trim();
    const many = Array.from({ length: 100 }, (_, i) => ({
      ...makeChunk(`c${i}`, 'neoplatonism', 'verified'),
      body: bigBody,
      token_count: Math.ceil(bigBody.length / 4),
    }));
    const result = buildBlogPrompt(['nous', 'tao'], [], null, many);
    const count = (result.match(/^\[\d+\]/gm) ?? []).length;
    expect(count).toBeLessThan(many.length);
  });

  it('falls back gracefully with no chunks', () => {
    const result = buildBlogPrompt(['a', 'b'], [], null, []);
    expect(result).toContain('No source passages');
    expect(result).toContain('ESSAY BRIEF');
  });
});

describe('buildBlogPromptFromTopic', () => {
  it('includes the topic verbatim in the essay brief, after SOURCE PASSAGES', () => {
    const chunks = [makeChunk('c1', 'hermeticism'), makeChunk('c2', 'taoism')];
    const result = buildBlogPromptFromTopic('the role of silence in mystical union', chunks);
    expect(result).toContain('SOURCE PASSAGES');
    expect(result).toContain('ESSAY BRIEF: Write a grounded essay on: the role of silence in mystical union');
    // the passages block precedes the brief
    expect(result.indexOf('SOURCE PASSAGES')).toBeLessThan(result.indexOf('ESSAY BRIEF'));
  });

  it('trims the topic and falls back gracefully with no chunks', () => {
    const result = buildBlogPromptFromTopic('  apophatic silence  ', []);
    expect(result).toContain('No source passages');
    expect(result).toContain('ESSAY BRIEF: Write a grounded essay on: apophatic silence');
  });

  it('drops chunks when the budget is tight', () => {
    const bigBody = 'the One overflows into being without diminishing '.repeat(80).trim();
    const many = Array.from({ length: 100 }, (_, i) => ({
      ...makeChunk(`c${i}`, 'neoplatonism', 'verified'),
      body: bigBody,
      token_count: Math.ceil(bigBody.length / 4),
    }));
    const result = buildBlogPromptFromTopic('emanation and silence', many);
    const count = (result.match(/^\[\d+\]/gm) ?? []).length;
    expect(count).toBeLessThan(many.length);
  });
});
