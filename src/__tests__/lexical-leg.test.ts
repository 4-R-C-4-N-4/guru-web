/**
 * src/__tests__/lexical-leg.test.ts
 *
 * Unit tests for the lexical (Postgres FTS) retrieval leg (todo:af69f5e5).
 * The DB is mocked — these assert the SQL shape, parameter threading, and the
 * lex_rank → lexRank mapping, not live retrieval (that's the integration test).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import { lexicalSearch } from '@/lib/retriever';
import { query } from '@/lib/db';
import type { UserPreferences } from '@/lib/types';

const ALL: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [], preferredModel: null, preferredVoice: 'scholar',
};

const row = (id: string, lex_rank: number) => ({
  id, text_id: 't', tradition: 'zoroastrianism', text_name: 'Yasna', section: 's',
  translator: null, body: 'Ahura Mazda', token_count: 2, source: 'lexical', lex_rank,
});

beforeEach(() => (query as Mock).mockReset());

describe('lexicalSearch — Postgres FTS leg (todo:af69f5e5)', () => {
  it('issues a plainto_tsquery / ts_rank full-text query ordered by rank', async () => {
    (query as Mock).mockResolvedValue([]);
    await lexicalSearch('Ahura Mazda and the Gathas', ALL, 20);

    const [sql, params] = (query as Mock).mock.calls[0];
    expect(sql).toMatch(/to_tsvector\('english', body\)\s*@@\s*plainto_tsquery\('english', \$1\)/);
    expect(sql).toMatch(/ts_rank\(.*\)\s+AS lex_rank/);
    expect(sql).toMatch(/ORDER BY lex_rank DESC/);
    // $1 = query text, last param = limit (scope 'all' adds none in between).
    expect(params[0]).toBe('Ahura Mazda and the Gathas');
    expect(params[params.length - 1]).toBe(20);
    expect(sql).toMatch(/LIMIT \$2/);
  });

  it('maps lex_rank → lexRank and keeps source = lexical', async () => {
    (query as Mock).mockResolvedValue([row('a', 0.19), row('b', 0.04)]);
    const out = await lexicalSearch('q', ALL, 10);

    expect(out).toHaveLength(2);
    expect(out[0].lexRank).toBe(0.19);
    expect(out[0].source).toBe('lexical');
    // The snake_case scratch field must not leak onto the chunk.
    expect((out[0] as unknown as Record<string, unknown>).lex_rank).toBeUndefined();
  });

  it('threads the scope filter after $1 and pushes LIMIT last', async () => {
    (query as Mock).mockResolvedValue([]);
    const blacklist: UserPreferences = { ...ALL, scopeMode: 'blacklist', blockedTraditions: ['taoism'] };
    await lexicalSearch('q', blacklist, 15);

    const [sql, params] = (query as Mock).mock.calls[0];
    // scope predicate occupies $2, so LIMIT slides to $3.
    expect(sql).toMatch(/tradition <> ALL\(\$2::text\[\]\)/);
    expect(sql).toMatch(/LIMIT \$3/);
    expect(params).toEqual(['q', ['taoism'], 15]);
  });
});
