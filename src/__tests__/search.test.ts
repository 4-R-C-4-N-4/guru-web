/**
 * src/__tests__/search.test.ts
 *
 * lib/search powers the public /read/search page (todo:3c342f3b). Contract:
 * filters translate into the retriever's own whitelist scoping, both legs
 * feed mergeAndRerank with the per-tradition cap disabled, and an Ollama
 * outage degrades to lexical-only (flagged) instead of erroring the page.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/retriever', () => ({
  vectorSearch: vi.fn(),
  lexicalSearch: vi.fn(),
  mergeAndRerank: vi.fn(),
}));

import { searchCorpus, filtersToPrefs } from '@/lib/search';
import { EmbedError } from '@/lib/embed';
import { vectorSearch, lexicalSearch, mergeAndRerank } from '@/lib/retriever';

const mVector = vectorSearch as MockedFunction<typeof vectorSearch>;
const mLexical = lexicalSearch as MockedFunction<typeof lexicalSearch>;
const mMerge = mergeAndRerank as MockedFunction<typeof mergeAndRerank>;

beforeEach(() => {
  vi.clearAllMocks();
  mVector.mockResolvedValue([]);
  mLexical.mockResolvedValue([]);
  mMerge.mockReturnValue([]);
});

describe('filtersToPrefs', () => {
  it('maps no filters to all-scope', () => {
    const p = filtersToPrefs({});
    expect(p.scopeMode).toBe('all');
    expect(p.whitelistedTraditions).toEqual([]);
  });

  it('maps tradition/text filters to a whitelist scope', () => {
    const p = filtersToPrefs({ tradition: 'gnosticism', text: 'gospel-of-thomas' });
    expect(p.scopeMode).toBe('whitelist');
    expect(p.whitelistedTraditions).toEqual(['gnosticism']);
    expect(p.whitelistedTexts).toEqual(['gospel-of-thomas']);
  });
});

describe('searchCorpus', () => {
  it('runs both legs and reranks with the tradition cap disabled', async () => {
    await searchCorpus('divine light', { tradition: 'taoism' }, 20);
    expect(mVector).toHaveBeenCalledOnce();
    expect(mLexical).toHaveBeenCalledOnce();
    const [, , topK, opts] = mMerge.mock.calls[0];
    expect(topK).toBe(20);
    expect(opts?.perTraditionCap).toBe(0);
  });

  it('degrades to lexical-only when Ollama is down, flagged', async () => {
    mVector.mockRejectedValue(new EmbedError('Ollama unreachable'));
    const lex = [{ id: 'a.b.001' }] as never;
    mLexical.mockResolvedValue(lex);
    mMerge.mockReturnValue(lex);
    const r = await searchCorpus('divine light');
    expect(r.lexicalOnly).toBe(true);
    expect(mMerge.mock.calls[0][0]).toEqual([]); // empty vector leg
    expect(mMerge.mock.calls[0][3]?.lexicalResults).toBe(lex);
  });

  it('rethrows non-embed errors (DB failures must not be swallowed)', async () => {
    mVector.mockRejectedValue(new Error('connection refused'));
    await expect(searchCorpus('x')).rejects.toThrow('connection refused');
  });
});
