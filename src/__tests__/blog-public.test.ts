/**
 * src/__tests__/blog-public.test.ts
 *
 * The public blog read helpers must never leak non-published posts. Mocks
 * the db layer and asserts the WHERE status='published' contract holds for
 * both listPublished and getPublishedBySlug, plus the dek-derivation.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ one: vi.fn(), query: vi.fn() }));

import { listPublished, getPublishedBySlug } from '@/lib/blog-public';
import { one, query } from '@/lib/db';

const mOne = one as MockedFunction<typeof one>;
const mQuery = query as MockedFunction<typeof query>;

beforeEach(() => vi.clearAllMocks());

describe('getPublishedBySlug', () => {
  it("only queries published rows (status='published' in SQL)", async () => {
    mOne.mockResolvedValue(null);
    await getPublishedBySlug('some-slug');
    const sql = mOne.mock.calls[0][0] as string;
    expect(sql).toMatch(/status\s*=\s*'published'/);
    expect(mOne.mock.calls[0][1]).toEqual(['some-slug']);
  });

  it('returns null for a slug that is not a published post (e.g. a draft)', async () => {
    mOne.mockResolvedValue(null); // the published-only query found nothing
    expect(await getPublishedBySlug('a-draft-slug')).toBeNull();
  });

  it('prefers the stored dek when present', async () => {
    mOne.mockResolvedValue({
      id: 'p1', title: 'T', slug: 's',
      dek: 'A framing line the model wrote.',
      content: 'The essay opens differently from its dek. More here.',
      chunks_used: null, published_at: 'x',
    } as never);
    const post = await getPublishedBySlug('s');
    expect(post?.dek).toBe('A framing line the model wrote.');
  });

  it('falls back to the first sentence of content when dek is null (legacy rows)', async () => {
    mOne.mockResolvedValue({
      id: 'p1',
      title: 'Two Names for One Source',
      slug: 'two-names',
      dek: null,
      content: 'The One overflows into being. A second sentence follows here.',
      chunks_used: [{ id: 'c1', tradition: 'neoplatonism', text_name: 'Enneads', section: 'V.1', tier: 'verified' }],
      published_at: '2026-05-31T00:00:00Z',
    } as never);

    const post = await getPublishedBySlug('two-names');
    expect(post?.title).toBe('Two Names for One Source');
    expect(post?.dek).toBe('The One overflows into being.');
    expect(post?.chunks_used).toHaveLength(1);
  });

  it('tolerates null chunks_used by returning an empty sources array', async () => {
    mOne.mockResolvedValue({
      id: 'p1', title: 'T', slug: 's', content: 'Body.', chunks_used: null, published_at: 'x',
    } as never);
    const post = await getPublishedBySlug('s');
    expect(post?.chunks_used).toEqual([]);
  });
});

describe('listPublished', () => {
  it("queries only published rows with a slug and content, reading only a left()-bounded dek source", async () => {
    mQuery.mockResolvedValue([]);
    await listPublished();
    const sql = mQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/status\s*=\s*'published'/);
    expect(sql).toMatch(/slug IS NOT NULL/);
    expect(sql).toMatch(/content IS NOT NULL/);
    expect(sql).toMatch(/ORDER BY published_at DESC/);
    // Never SELECT the full essay body for a card — only a bounded dek source.
    expect(sql).toMatch(/left\(content, \d+\) AS dek_source/);
  });

  it('derives a null dek (does not throw) when a row has null dek_source', async () => {
    mQuery.mockResolvedValue([
      { title: 'T', slug: 't', dek: null, dek_source: null, published_at: '2026-05-31' },
    ] as never);
    const items = await listPublished();
    expect(items[0].dek).toBeNull();
  });

  it('appends LIMIT only when a limit is passed (homepage feed vs full index)', async () => {
    mQuery.mockResolvedValue([]);
    await listPublished();
    expect(mQuery.mock.calls[0][0] as string).not.toMatch(/LIMIT/);
    expect(mQuery.mock.calls[0][1]).toBeUndefined();

    await listPublished(3);
    expect(mQuery.mock.calls[1][0] as string).toMatch(/LIMIT \$1/);
    expect(mQuery.mock.calls[1][1]).toEqual([3]);
  });

  it('maps rows to cards, preferring the stored dek and falling back to the dek source', async () => {
    mQuery.mockResolvedValue([
      { title: 'A', slug: 'a', dek: 'Stored framing.', dek_source: 'First sentence here. More.', published_at: '2026-05-31' },
      { title: 'B', slug: 'b', dek: null, dek_source: 'Legacy first sentence. More.', published_at: '2026-05-30' },
    ] as never);
    const items = await listPublished();
    expect(items[0]).toMatchObject({ title: 'A', slug: 'a', dek: 'Stored framing.' });
    expect(items[1]).toMatchObject({ title: 'B', slug: 'b', dek: 'Legacy first sentence.' });
  });
});
