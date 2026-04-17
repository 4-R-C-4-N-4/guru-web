/**
 * src/__tests__/graph.test.ts
 *
 * Unit tests for extractConcepts wildcard sanitisation.
 * DB query is mocked.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  query:  vi.fn(),
  one:    vi.fn(),
  exec:   vi.fn(),
}));

import * as db from '@/lib/db';
const mockQuery = db.query as MockedFunction<typeof db.query>;

import { extractConcepts } from '@/lib/graph';

describe('extractConcepts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('strips LIKE wildcards from query text before building patterns', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await extractConcepts('100% divine spark_bad');

    expect(mockQuery).toHaveBeenCalledOnce();
    const [, params] = mockQuery.mock.calls[0];
    // '%' and '_' removed: '100 divine sparkbad' → three words
    expect(params).toEqual(['%100%', '%divine%', '%sparkbad%']);
  });

  it('returns empty array for queries with no words > 2 chars after sanitisation', async () => {
    const result = await extractConcepts('% _ %% __');
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns concept IDs from matched rows', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'divine-spark' }, { id: 'gnosis' }]);

    const result = await extractConcepts('divine spark gnosis');
    expect(result).toEqual(['divine-spark', 'gnosis']);
  });
});
