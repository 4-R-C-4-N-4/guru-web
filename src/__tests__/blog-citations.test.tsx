/**
 * src/__tests__/blog-citations.test.tsx
 *
 * Regression for todo:ad5159c9 — hand-authored / edited posts carry the
 * CITATIONS block in their body and have no structured chunks_used. The public
 * post page must parse that block into styled Sources cards and render the body
 * without the raw block. Posts WITH chunks_used keep their existing rendering.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/blog-public', () => ({ getPublishedBySlug: vi.fn() }));

import { getPublishedBySlug } from '@/lib/blog-public';
import type { PublishedPost } from '@/lib/blog-public';
import BlogPostPage from '@/app/blog/[slug]/page';

const mockGet = getPublishedBySlug as MockedFunction<typeof getPublishedBySlug>;

const BASE: PublishedPost = {
  id: 'p1', title: 'A Hand-Written Essay', slug: 'hand', dek: 'A framing.',
  content: '', chunks_used: [], published_at: '2026-06-01T00:00:00Z',
};

async function render(post: PublishedPost): Promise<string> {
  mockGet.mockResolvedValue(post);
  const el = await BlogPostPage({ params: Promise.resolve({ slug: post.slug }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => vi.clearAllMocks());

describe('blog post page — citations', () => {
  it('parses a typed CITATIONS block (no chunks_used) into styled Sources and strips it from the body', async () => {
    const html = await render({
      ...BASE,
      content: 'The Tao that can be told is not the eternal Tao.\n\nCITATIONS:\n[taoism | Tao Te Ching | 1 | TIER: verified]',
    });
    expect(html).toContain('eternal Tao');     // body survives
    expect(html).not.toContain('CITATIONS:');   // raw block stripped
    expect(html).not.toContain('| TIER:');       // raw entry line stripped
    expect(html).toContain('Sources');           // styled section present
    expect(html).toContain('Tao Te Ching');      // card built from the parsed entry
  });

  it('leaves structured chunks_used posts unchanged (no parsing of the body)', async () => {
    const html = await render({
      ...BASE,
      content: 'Generated prose with no citation tail.',
      chunks_used: [{ id: 'ch1', tradition: 'neoplatonism', text_name: 'Enneads', section: 'V.1', tier: 'proposed' }],
    });
    expect(html).toContain('Generated prose');
    expect(html).toContain('Sources');
    expect(html).toContain('Enneads');
  });

  it('renders no Sources section when there is neither chunks_used nor a CITATIONS block', async () => {
    const html = await render({ ...BASE, content: 'Just prose, nothing to cite.' });
    expect(html).toContain('Just prose');
    expect(html).not.toContain('Sources');
  });
});
