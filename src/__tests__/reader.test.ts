/**
 * src/__tests__/reader.test.ts
 *
 * SQL-shape guards for the reader data layer. Reading order has no
 * dedicated column — it IS lexicographic id order — so the prev/next and
 * TOC queries must ORDER BY id; related-passage edges are stored one
 * direction, so the query must match both endpoints; tags must be scoped
 * to EXPRESSES; and text-boundary continuation must follow
 * works.member_text_ids.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import { getChunkPage, getChunkTags, getRelatedPassages, getTextToc } from '@/lib/reader';
import { query, one } from '@/lib/db';

const mQuery = query as MockedFunction<typeof query>;
const mOne = one as MockedFunction<typeof one>;

beforeEach(() => vi.clearAllMocks());

const CHUNK_ROW = {
  id: 'trad.text-a.002', text_id: 'text-a', tradition: 'trad', text_name: 'Text A',
  section: 'II', translator: null, body: 'x', token_count: 1,
  text_label: 'Text A', source_url: null, sections_format: 'section',
  work_id: 'work-1', tradition_label: 'Trad', member_text_ids: ['text-a', 'text-b'],
};

describe('getChunkPage', () => {
  it('orders prev/next by id within the text', async () => {
    mOne.mockResolvedValueOnce(CHUNK_ROW as never);
    mOne.mockResolvedValue({ id: 'trad.text-a.001', section: 'I' } as never);
    await getChunkPage('trad.text-a.002');
    const sqls = mOne.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /id < \$2 ORDER BY id DESC LIMIT 1/.test(s))).toBe(true);
    expect(sqls.some(s => /id > \$2 ORDER BY id ASC LIMIT 1/.test(s))).toBe(true);
    expect(sqls.some(s => /COUNT\(\*\) FILTER \(WHERE id <= \$2\)/.test(s))).toBe(true);
  });

  it('continues into the adjacent member text at a boundary, flagged crossText', async () => {
    mOne.mockResolvedValueOnce(CHUNK_ROW as never);           // chunk row
    mOne.mockResolvedValueOnce({ id: 'trad.text-a.001', section: 'I' } as never); // prev
    mOne.mockResolvedValueOnce(null as never);                // next within text: none
    mOne.mockResolvedValueOnce({ total: 2, pos: 2 } as never); // position
    mOne.mockResolvedValueOnce({ id: 'trad.text-b.001', section: 'I', text_label: 'Text B' } as never); // boundary
    const page = await getChunkPage('trad.text-a.002');
    expect(page?.next).toEqual({ id: 'trad.text-b.001', section: 'I', textLabel: 'Text B', crossText: true });
    const boundarySql = mOne.mock.calls[4][0] as string;
    expect(boundarySql).toMatch(/ORDER BY c\.id ASC/);
  });

  it('returns null next at the end of the last member text', async () => {
    mOne.mockResolvedValueOnce({ ...CHUNK_ROW, text_id: 'text-b', member_text_ids: ['text-a', 'text-b'] } as never);
    mOne.mockResolvedValueOnce({ id: 'trad.text-b.001', section: 'I' } as never);
    mOne.mockResolvedValueOnce(null as never);
    mOne.mockResolvedValueOnce({ total: 2, pos: 2 } as never);
    const page = await getChunkPage('trad.text-b.002');
    expect(page?.next).toBeNull();
  });
});

describe('getChunkTags', () => {
  it('selects only EXPRESSES edges joined to concepts', async () => {
    mQuery.mockResolvedValue([]);
    await getChunkTags('trad.text-a.001');
    const sql = mQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/edge_type = 'EXPRESSES'/);
    expect(sql).toMatch(/JOIN concepts/);
  });
});

describe('getRelatedPassages', () => {
  it('matches both edge directions and joins the partner endpoint', async () => {
    mQuery.mockResolvedValue([]);
    await getRelatedPassages('trad.text-a.001');
    const sql = mQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/e\.source = \$1 OR e\.target = \$1/);
    expect(sql).toMatch(/CASE WHEN e\.source = \$1 THEN e\.target ELSE e\.source END/);
    expect(sql).toMatch(/'PARALLELS','CONTRASTS'/);
  });

  it('ranks partners by weight before falling back to tier and id (todo:bc084b37)', async () => {
    mQuery.mockResolvedValue([]);
    await getRelatedPassages('trad.text-a.001');
    const sql = mQuery.mock.calls[0][0] as string;
    // NULLS LAST matters: frozen CONTRASTS carry no weight, and a bare DESC
    // would sort those nulls first in Postgres.
    expect(sql).toMatch(/ORDER BY[\s\S]*e\.weight DESC NULLS LAST/);
    // Weight must outrank the tier bucket — every derived PARALLELS row shares
    // tier='inferred', so tier-first collapses the order back to alphabetical.
    const order = sql.slice(sql.indexOf('ORDER BY'));
    expect(order.indexOf('e.weight')).toBeLessThan(order.indexOf('CASE e.tier'));
    expect(order.indexOf('CASE e.tier')).toBeLessThan(order.indexOf('p.id'));
  });

  it('caps how many partners one panel loads (todo:bc084b37)', async () => {
    mQuery.mockResolvedValue([]);
    await getRelatedPassages('trad.text-a.001');
    const [sql, params] = mQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/LIMIT \$2/);
    // Editorial cap, not a corpus-derived one: the page shows 10 and hides the
    // rest behind a toggle, so this leaves a short tail. Kept small on purpose
    // — an earlier 100 tracked a p95 that the generator has since invalidated.
    expect(params[1]).toBe(15);
  });
});

describe('getTextToc', () => {
  it('orders the section list by id and spans by first child chunk', async () => {
    mOne.mockResolvedValueOnce({ id: 'text-a', tradition: 'trad' } as never);
    mOne.mockResolvedValueOnce(null as never); // work summary
    mQuery.mockResolvedValue([]);
    await getTextToc('text-a');
    const sqls = mQuery.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => /FROM chunks WHERE text_id = \$1 ORDER BY id/.test(s))).toBe(true);
    expect(sqls.some(s => /level = 1[\s\S]*ORDER BY child_chunk_ids\[1\]/.test(s))).toBe(true);
  });
});
