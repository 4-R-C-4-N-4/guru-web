/**
 * src/__tests__/concept-index.test.ts
 *
 * listConceptIndex powers the public /read/concepts browse page
 * (todo:a9e37a38). It must return ALL concepts (unplaced ones included, so
 * none become unreachable), count passages via EXPRESSES fan-in only, and
 * leave domain/family assembly to the page (families come back flat).
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import { listConceptIndex } from '@/lib/reader';
import { query } from '@/lib/db';

const mQuery = query as MockedFunction<typeof query>;

beforeEach(() => vi.clearAllMocks());

describe('listConceptIndex', () => {
  it('reads families flat and concepts with EXPRESSES counts, no family filter', async () => {
    mQuery.mockResolvedValue([]);
    await listConceptIndex();
    const sqls = mQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /FROM concept_families ORDER BY id/.test(s))).toBe(true);
    const conceptSql = sqls.find(s => /FROM concepts co/.test(s))!;
    expect(conceptSql).toMatch(/e\.edge_type = 'EXPRESSES'/);
    expect(conceptSql).toMatch(/LEFT JOIN edges/);
    // No WHERE family_id filter — unplaced concepts must be returned too.
    expect(conceptSql).not.toMatch(/family_id IS NOT NULL/);
  });

  it('returns both result sets verbatim', async () => {
    mQuery
      .mockResolvedValueOnce([{ id: 'cosmology', parent_id: null, label: 'Cosmology', definition: null }] as never)
      .mockResolvedValueOnce([{ id: 'concept.pleroma', label: 'Pleroma', definition: null, family_id: null, passages: 12 }] as never);
    const { families, concepts } = await listConceptIndex();
    expect(families).toHaveLength(1);
    expect(concepts[0].passages).toBe(12);
  });
});
