/**
 * src/__tests__/corpus.test.ts
 *
 * listTraditions powers the homepage badge row. It must read from `chunks`
 * (the retrievable surface, like /api/corpus), order by prominence, and return
 * a bare slug list — with no hardcoded fallback when the corpus is empty.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import { listTraditions } from '@/lib/corpus';
import { query } from '@/lib/db';

const mQuery = query as MockedFunction<typeof query>;

beforeEach(() => vi.clearAllMocks());

describe('listTraditions', () => {
  it('aggregates from chunks, ordered by chunk count desc', async () => {
    mQuery.mockResolvedValue([]);
    await listTraditions();
    const sql = mQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/FROM\s+chunks/);
    expect(sql).toMatch(/GROUP BY\s+tradition/);
    expect(sql).toMatch(/ORDER BY\s+COUNT\(\*\)\s+DESC/);
    expect(sql).toMatch(/tradition IS NOT NULL/);
  });

  it('returns bare tradition slugs in the DB order', async () => {
    mQuery.mockResolvedValue([
      { tradition: 'neoplatonism' },
      { tradition: 'egyptian' },
      { tradition: 'taoism' },
    ] as never);
    expect(await listTraditions()).toEqual(['neoplatonism', 'egyptian', 'taoism']);
  });

  it('surfaces an empty corpus as [] (no hardcoded fallback)', async () => {
    mQuery.mockResolvedValue([]);
    expect(await listTraditions()).toEqual([]);
  });
});
