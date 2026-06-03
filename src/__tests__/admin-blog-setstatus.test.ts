/**
 * src/__tests__/admin-blog-setstatus.test.ts
 *
 * setStatus is the editorial state-machine boundary. Publishing must be guarded
 * to a generated draft (status='draft' AND content IS NOT NULL) so an
 * ungenerated/empty row can't go live and 500 the public list paths
 * (todo:07cc01d5). Exercises the real helper with the db layer mocked.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ one: vi.fn(), query: vi.fn(), exec: vi.fn() }));

import { setStatus } from '@/lib/admin-blog';
import { one } from '@/lib/db';

const mOne = one as MockedFunction<typeof one>;

beforeEach(() => vi.clearAllMocks());

describe('setStatus publish guard', () => {
  it("only publishes a draft with content (SQL carries the guard)", async () => {
    mOne.mockResolvedValueOnce({ id: 'p1', status: 'published' } as never); // UPDATE … RETURNING
    await setStatus('p1', 'published');
    const sql = mOne.mock.calls[0][0] as string;
    expect(sql).toMatch(/UPDATE blog_posts/);
    expect(sql).toMatch(/status = 'draft'/);
    expect(sql).toMatch(/content IS NOT NULL/);
    expect(sql).toMatch(/published_at = now\(\)/);
  });

  it('reject/archive are NOT guarded by status (any source state moves out of public view)', async () => {
    mOne.mockResolvedValueOnce({ id: 'p1', status: 'rejected' } as never);
    await setStatus('p1', 'rejected');
    const sql = mOne.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/status = 'draft'/);
    expect(sql).not.toMatch(/published_at = now\(\)/);
  });

  it('returns ok:true with the row when the guarded UPDATE applies', async () => {
    mOne.mockResolvedValueOnce({ id: 'p1', status: 'published' } as never);
    expect(await setStatus('p1', 'published')).toEqual({ ok: true, row: { id: 'p1', status: 'published' } });
  });

  it('reports illegal_transition when 0 rows updated but the post exists', async () => {
    mOne.mockResolvedValueOnce(null);                          // UPDATE matched nothing
    mOne.mockResolvedValueOnce({ id: 'p1', status: 'queued' } as never); // getPost finds it
    expect(await setStatus('p1', 'published')).toEqual({ ok: false, reason: 'illegal_transition' });
  });

  it('reports not_found when 0 rows updated and the post is missing', async () => {
    mOne.mockResolvedValueOnce(null); // UPDATE matched nothing
    mOne.mockResolvedValueOnce(null); // getPost: gone
    expect(await setStatus('missing', 'published')).toEqual({ ok: false, reason: 'not_found' });
  });
});
