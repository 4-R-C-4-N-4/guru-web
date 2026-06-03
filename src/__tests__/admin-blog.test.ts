/**
 * src/__tests__/admin-blog.test.ts
 *
 * Endpoint contract for the mutating blog admin routes (IMPL T4).
 *
 * Strategy: mock requireAdmin, the admin-blog lib helpers, and generateDraft.
 * Assert: 404 to non-admins on every route; seed validation rejects non-pairs
 * and bad slugs; seed inserts on the happy path; generate delegates to
 * generateDraft and returns the row; publish/reject/archive call setStatus.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/admin-blog', () => ({
  insertSeed: vi.fn(),
  setStatus: vi.fn(),
  getPost: vi.fn(),
  listPosts: vi.fn(),
  listCorpusCatalog: vi.fn(),
}));
vi.mock('@/lib/blog-generate', () => ({ generateDraft: vi.fn() }));

import * as admin from '@/lib/admin';
import * as adminBlog from '@/lib/admin-blog';
import * as gen from '@/lib/blog-generate';

const mReq = admin.requireAdmin as MockedFunction<typeof admin.requireAdmin>;
const mInsert = adminBlog.insertSeed as MockedFunction<typeof adminBlog.insertSeed>;
const mSetStatus = adminBlog.setStatus as MockedFunction<typeof adminBlog.setStatus>;
const mGetPost = adminBlog.getPost as MockedFunction<typeof adminBlog.getPost>;
const mGenerate = gen.generateDraft as MockedFunction<typeof gen.generateDraft>;

const ADMIN = { id: 'tailnet', email: 'admin@tailnet', tier: 'pro' as const, stripe_customer_id: null, payment_state: null };

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const seedReq = (body: unknown) =>
  new Request('http://t/api/admin/blog/seed', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/admin/blog/seed — auth', () => {
  it('404s without admin trust', async () => {
    mReq.mockResolvedValue(new Response(null, { status: 404 }));
    const { POST } = await import('@/app/api/admin/blog/seed/route');
    const res = await POST(seedReq({ concept_ids: ['a', 'b'], model: 'deepseek' }));
    expect(res.status).toBe(404);
    expect(mInsert).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/blog/seed — validation', () => {
  beforeEach(() => mReq.mockResolvedValue(ADMIN));

  it('rejects a non-pair concept_ids (400)', async () => {
    const { POST } = await import('@/app/api/admin/blog/seed/route');
    const res = await POST(seedReq({ concept_ids: ['only-one'], model: 'deepseek' }));
    expect(res.status).toBe(400);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown model slug (400)', async () => {
    const { POST } = await import('@/app/api/admin/blog/seed/route');
    const res = await POST(seedReq({ concept_ids: ['a', 'b'], model: 'not-a-model' }));
    expect(res.status).toBe(400);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid scope_mode (400)', async () => {
    const { POST } = await import('@/app/api/admin/blog/seed/route');
    const res = await POST(seedReq({ concept_ids: ['a', 'b'], model: 'deepseek', scope_mode: 'sideways' }));
    expect(res.status).toBe(400);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('accepts a free-text topic seed (201) and passes topic, null concept_ids', async () => {
    mInsert.mockResolvedValue({ id: 'pt', status: 'queued' } as never);
    const { POST } = await import('@/app/api/admin/blog/seed/route');
    const res = await POST(seedReq({ topic: 'the role of silence in mystical union', model: 'deepseek' }));
    expect(res.status).toBe(201);
    const arg = mInsert.mock.calls[0][0];
    expect(arg.topic).toBe('the role of silence in mystical union');
    expect(arg.concept_ids).toBeNull();
  });

  it('rejects a seed with neither topic nor a concept pair (400)', async () => {
    const { POST } = await import('@/app/api/admin/blog/seed/route');
    const res = await POST(seedReq({ model: 'deepseek' }));
    expect(res.status).toBe(400);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('inserts a queued seed on the happy path (201) with operator email', async () => {
    mInsert.mockResolvedValue({ id: 'p1', status: 'queued' } as never);
    const { POST } = await import('@/app/api/admin/blog/seed/route');
    const res = await POST(seedReq({
      concept_ids: ['c-a', 'c-b'],
      model: 'anthropic',
      scope_mode: 'all',
      angle: 'both resist a made world',
    }));
    expect(res.status).toBe(201);
    expect(mInsert).toHaveBeenCalledOnce();
    const arg = mInsert.mock.calls[0][0];
    expect(arg.concept_ids).toEqual(['c-a', 'c-b']);
    expect(arg.model).toBe('anthropic');
    expect(arg.angle).toBe('both resist a made world');
    expect(arg.created_by).toBe('admin@tailnet');
  });
});

describe('POST /api/admin/blog/:id/generate', () => {
  it('404s without admin trust', async () => {
    mReq.mockResolvedValue(new Response(null, { status: 404 }));
    const { POST } = await import('@/app/api/admin/blog/[id]/generate/route');
    const res = await POST(new Request('http://t', { method: 'POST' }), ctx('p1'));
    expect(res.status).toBe(404);
    expect(mGenerate).not.toHaveBeenCalled();
  });

  it('delegates to generateDraft and returns the resulting row', async () => {
    mReq.mockResolvedValue(ADMIN);
    mGenerate.mockResolvedValue(undefined);
    mGetPost.mockResolvedValue({ id: 'p1', status: 'draft' } as never);
    const { POST } = await import('@/app/api/admin/blog/[id]/generate/route');
    const res = await POST(new Request('http://t', { method: 'POST' }), ctx('p1'));
    expect(mGenerate).toHaveBeenCalledWith('p1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'p1', status: 'draft' });
  });

  it('404s when the post does not exist after generation', async () => {
    mReq.mockResolvedValue(ADMIN);
    mGenerate.mockResolvedValue(undefined);
    mGetPost.mockResolvedValue(null);
    const { POST } = await import('@/app/api/admin/blog/[id]/generate/route');
    const res = await POST(new Request('http://t', { method: 'POST' }), ctx('missing'));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/blog/:id/{publish,reject,archive}', () => {
  const cases: Array<['publish' | 'reject' | 'archive', string]> = [
    ['publish', 'published'],
    ['reject', 'rejected'],
    ['archive', 'archived'],
  ];

  for (const [route, status] of cases) {
    it(`${route} 404s without admin trust`, async () => {
      mReq.mockResolvedValue(new Response(null, { status: 404 }));
      const { POST } = await import(`@/app/api/admin/blog/[id]/${route}/route`);
      const res = await POST(new Request('http://t', { method: 'POST' }), ctx('p1'));
      expect(res.status).toBe(404);
      expect(mSetStatus).not.toHaveBeenCalled();
    });

    it(`${route} calls setStatus(id, '${status}')`, async () => {
      mReq.mockResolvedValue(ADMIN);
      mSetStatus.mockResolvedValue({ ok: true, row: { id: 'p1', status } } as never);
      const { POST } = await import(`@/app/api/admin/blog/[id]/${route}/route`);
      const res = await POST(new Request('http://t', { method: 'POST' }), ctx('p1'));
      expect(mSetStatus).toHaveBeenCalledWith('p1', status);
      expect(res.status).toBe(200);
    });

    it(`${route} 404s when the post is missing`, async () => {
      mReq.mockResolvedValue(ADMIN);
      mSetStatus.mockResolvedValue({ ok: false, reason: 'not_found' } as never);
      const { POST } = await import(`@/app/api/admin/blog/[id]/${route}/route`);
      const res = await POST(new Request('http://t', { method: 'POST' }), ctx('missing'));
      expect(res.status).toBe(404);
    });

    it(`${route} 409s when the transition is illegal (guard blocked)`, async () => {
      mReq.mockResolvedValue(ADMIN);
      mSetStatus.mockResolvedValue({ ok: false, reason: 'illegal_transition' } as never);
      const { POST } = await import(`@/app/api/admin/blog/[id]/${route}/route`);
      const res = await POST(new Request('http://t', { method: 'POST' }), ctx('p1'));
      expect(res.status).toBe(409);
    });
  }
});
