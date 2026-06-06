/**
 * src/__tests__/atlas.test.ts
 *
 * computeAtlasSnapshot is the deterministic spine of the State of the Atlas
 * essay. Two invariants must hold or the essay's credibility collapses:
 *   - every headline/parallel query is tier-gated to 'verified'
 *   - NO query reads `weight` (it ships null on 100% of edges)
 * Plus: the snapshot maps the rows into the documented shape.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import { computeAtlasSnapshot } from '@/lib/atlas';
import { query, one } from '@/lib/db';

const mQuery = query as MockedFunction<typeof query>;
const mOne = one as MockedFunction<typeof one>;

const EXEMPLAR_ROW = {
  id: 'a1', tradition: 'neoplatonism', text_name: 'Enneads', section: 'V.1',
  translator: null, body: 'The One overflows.', token_count: 5,
  b_id: 'b1', b_tradition: 'taoism', b_text_name: 'Chuang Tzu', b_section: 'Bk 1',
  b_translator: null, b_body: 'The uncarved block.', b_token_count: 5, edge_tier: 'verified',
};

beforeEach(() => {
  vi.clearAllMocks();
  mOne.mockImplementation(async (sql: string) => {
    if (sql.includes('corpus_metadata')) return { value: '3' } as never;
    if (sql.includes('parallels_verified')) {
      return { traditions: 16, concepts: 95, families: 28, parallels_verified: 4252, parallels_proposed: 382, contrasts: 8 } as never;
    }
    return null as never;
  });
  mQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('GROUP BY a, b')) return [{ a: 'christian_mysticism', b: 'neoplatonism', parallels: 1073 }] as never;
    if (sql.includes('partner_traditions')) return [{ tradition: 'neoplatonism', chunks: 828, parallel_degree: 2500, partner_traditions: 13, per100: 301.9 }] as never;
    if (sql.includes('co.label')) return [{ label: 'Apophatic Theology', domain: 'theology', traditions: 15, mentions: 646 }] as never;
    if (sql.includes("edge_type='CONTRASTS'")) return [EXEMPLAR_ROW] as never;
    if (sql.includes('cs.tradition=$1')) return [EXEMPLAR_ROW] as never; // exemplarsForPair
    return [] as never;
  });
});

describe('computeAtlasSnapshot', () => {
  it('tier-gates every parallel/headline query to verified and never reads weight', async () => {
    await computeAtlasSnapshot('2026-06-06T00:00:00Z');
    const allSql = [...mQuery.mock.calls, ...mOne.mock.calls].map(c => c[0] as string);

    // No query may reference the (always-null) weight column.
    for (const sql of allSql) expect(sql).not.toMatch(/\bweight\b/);

    // Parallel-counting queries are tier-gated.
    const parallelSql = allSql.filter(s => /edge_type='PARALLELS'/.test(s));
    expect(parallelSql.length).toBeGreaterThan(0);
    for (const sql of parallelSql) expect(sql).toMatch(/tier\s*=\s*'verified'/);
  });

  it('maps rows into the documented snapshot shape', async () => {
    const snap = await computeAtlasSnapshot('2026-06-06T00:00:00Z');
    expect(snap.generatedAt).toBe('2026-06-06T00:00:00Z');
    expect(snap.schemaVersion).toBe('3');
    expect(snap.headline.parallelsVerified).toBe(4252);
    expect(snap.headline.parallelsProposed).toBe(382);
    expect(snap.traditionMatrix[0]).toMatchObject({ a: 'christian_mysticism', b: 'neoplatonism', parallels: 1073 });
    expect(snap.centrality[0]).toMatchObject({ tradition: 'neoplatonism', parallelsPer100Chunks: 301.9 });
    expect(snap.bridgeConcepts[0]).toMatchObject({ label: 'Apophatic Theology', traditions: 15 });
    expect(snap.longRangeCases.length).toBeGreaterThan(0);
    expect(snap.longRangeCases[0].exemplars[0].a.tradition).toBe('neoplatonism');
    expect(snap.longRangeCases[0].exemplars[0].b.tradition).toBe('taoism');
    expect(snap.contrasts.length).toBe(1);
  });

  it('uses the EXPRESSES edge for bridge concepts', async () => {
    await computeAtlasSnapshot('2026-06-06T00:00:00Z');
    const bridgeSql = mQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('co.label'));
    expect(bridgeSql).toMatch(/edge_type='EXPRESSES'/);
  });
});
