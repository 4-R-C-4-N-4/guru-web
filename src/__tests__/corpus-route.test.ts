/**
 * src/__tests__/corpus-route.test.ts
 *
 * GET /api/corpus aggregation contract (todo:5b6d6a14).
 *
 * Scope blocking filters on text_id, so a display label that groups many
 * member texts (26× "The Dhammapada") must expose ALL member ids via
 * `ids` — the settings page blocks the union or most of the work stays
 * retrievable. `chunks` per tradition weights the scope spectrum bar.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/auth', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import { GET } from '@/app/api/corpus/route';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

const mRequireUser = requireUser as MockedFunction<typeof requireUser>;
const mQuery = query as MockedFunction<typeof query>;

beforeEach(() => {
  vi.clearAllMocks();
  mRequireUser.mockResolvedValue({ id: 'u1', tier: 'free' } as never);
});

function mockCorpus(chunkRows: unknown[], workRows: unknown[] = []) {
  // Route issues [chunks aggregate, works] via Promise.all in order.
  mQuery
    .mockResolvedValueOnce(chunkRows as never)
    .mockResolvedValueOnce(workRows as never);
}

describe('GET /api/corpus', () => {
  it('accumulates all member text ids under one deduped label', async () => {
    mockCorpus([
      { tradition: 'buddhism', text_id: 'dhp.1', text_name: 'The Dhammapada', chunks: 10 },
      { tradition: 'buddhism', text_id: 'dhp.2', text_name: 'The Dhammapada', chunks: 12 },
      { tradition: 'buddhism', text_id: 'dhp.3', text_name: 'The Dhammapada', chunks: 8 },
    ]);
    const res = await GET();
    const body = await res.json();
    const b = body.traditions.buddhism;
    expect(b.texts).toEqual(['The Dhammapada']);            // display dedupes
    expect(b.text_items).toHaveLength(1);
    expect(b.text_items[0].id).toBe('dhp.1');               // pin id: first member
    expect(b.text_items[0].ids).toEqual(['dhp.1', 'dhp.2', 'dhp.3']); // block ids: all
  });

  it('sums chunk counts per tradition for spectrum weighting', async () => {
    mockCorpus([
      { tradition: 'taoism', text_id: 'ttc', text_name: 'Tao Te Ching', chunks: 30 },
      { tradition: 'taoism', text_id: 'zz', text_name: 'Zhuangzi', chunks: 20 },
      { tradition: 'gnosticism', text_id: 'gth', text_name: 'Gospel of Thomas', chunks: 5 },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body.traditions.taoism.chunks).toBe(50);
    expect(body.traditions.gnosticism.chunks).toBe(5);
  });

  it('groups the chunk query so counts ride the same distinct rows', async () => {
    mockCorpus([]);
    await GET();
    const sql = mQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/count\(\*\)::int/i);
    expect(sql).toMatch(/GROUP BY\s+tradition,\s*text_id,\s*text_name/i);
  });

  it('surfaces an empty corpus as {} (no hardcoded fallback)', async () => {
    mockCorpus([]);
    const res = await GET();
    const body = await res.json();
    expect(body.traditions).toEqual({});
    expect(body.works).toEqual([]);
  });
});
