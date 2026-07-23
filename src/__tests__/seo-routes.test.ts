/**
 * src/__tests__/seo-routes.test.ts
 *
 * The crawl surface (todo:64521773): /robots.txt must point crawlers at the
 * sitemap and keep the authed app surface out of the index; /sitemap.xml must
 * list the static public pages plus every published essay. Mocks the
 * blog-public layer — the published-only contract is its own test file.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/blog-public', () => ({ listPublishedCached: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { listPublishedCached } from '@/lib/blog-public';
import { query } from '@/lib/db';

const mList = listPublishedCached as MockedFunction<typeof listPublishedCached>;
const mQuery = query as MockedFunction<typeof query>;

// sitemap issues two reader scans: texts (id, tradition) then chunks (id).
function mockCorpus(texts: { id: string; tradition: string }[], chunks: { id: string }[]) {
  mQuery.mockImplementation(async (sql: string) =>
    (/FROM texts/.test(sql) ? texts : chunks) as never);
}

beforeEach(() => vi.clearAllMocks());

describe('robots.txt route', () => {
  it('allows the public surface and points at the sitemap', () => {
    const out = robots();
    expect(out.sitemap).toBe('https://guru-ai.org/sitemap.xml');
    const rule = Array.isArray(out.rules) ? out.rules[0] : out.rules;
    expect(rule?.allow).toBe('/');
    expect(rule?.disallow).toContain('/api/');
    expect(rule?.disallow).toContain('/chat');
    // The public content pages must NOT be disallowed.
    expect(rule?.disallow).not.toContain('/blog');
    expect(rule?.disallow).not.toContain('/atlas');
  });
});

describe('sitemap.xml route', () => {
  it('lists static pages plus every published post at /blog/[slug]', async () => {
    mList.mockResolvedValue([
      { title: 'Two Names', slug: 'two-names', dek: null, published_at: '2026-06-01T00:00:00Z' },
      { title: 'Atlas №1', slug: 'state-of-the-atlas-1', dek: null, published_at: '2026-07-01T00:00:00Z' },
    ]);
    mockCorpus([], []);
    const entries = await sitemap();
    const urls = entries.map(e => e.url);
    expect(urls).toContain('https://guru-ai.org/');
    expect(urls).toContain('https://guru-ai.org/blog');
    expect(urls).toContain('https://guru-ai.org/atlas');
    expect(urls).toContain('https://guru-ai.org/blog/two-names');
    expect(urls).toContain('https://guru-ai.org/blog/state-of-the-atlas-1');
    // Posts carry lastModified from published_at so crawlers see freshness.
    const post = entries.find(e => e.url.endsWith('/blog/two-names'));
    expect(post?.lastModified).toEqual(new Date('2026-06-01T00:00:00Z'));
  });

  it('lists the reader surface: /read, traditions, text TOCs and chunk pages', async () => {
    mList.mockResolvedValue([]);
    mockCorpus(
      [{ id: 'gospel-of-thomas', tradition: 'gnosticism' }],
      [{ id: 'gnosticism.gospel-of-thomas.001' }],
    );
    const urls = (await sitemap()).map(e => e.url);
    expect(urls).toContain('https://guru-ai.org/read');
    expect(urls).toContain('https://guru-ai.org/read/gnosticism');
    expect(urls).toContain('https://guru-ai.org/read/gnosticism/gospel-of-thomas');
    expect(urls).toContain('https://guru-ai.org/read/gnosticism/gospel-of-thomas/001');
  });

  it('surfaces an empty published list as-is (no phantom entries)', async () => {
    mList.mockResolvedValue([]);
    mockCorpus([], []);
    const entries = await sitemap();
    expect(entries).toHaveLength(4); // just the static pages (incl. /read)
  });
});
