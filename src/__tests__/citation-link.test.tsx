/**
 * src/__tests__/citation-link.test.tsx
 *
 * Citation cards link into the /read source library when they carry a
 * resolvable id — chunk ids to the chunk page, sum: ids to the summary
 * page — and render exactly as before (no link) when the id is absent,
 * so parsed-block fallbacks and legacy snapshots keep working.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Citation from '@/components/citation';

describe('Citation reader links', () => {
  it('wraps the card in a link to the chunk page when id is a chunk id', () => {
    const html = renderToStaticMarkup(
      <Citation id="gnosticism.gospel-of-thomas.002" tradition="gnosticism" text="Gospel of Thomas" section="Logion 2" />,
    );
    expect(html).toContain('href="/read/gnosticism/gospel-of-thomas/002"');
  });

  it('links sum: ids to the summary page', () => {
    const html = renderToStaticMarkup(
      <Citation id="sum:adapa-food-of-life" tradition="mesopotamian" text="Adapa" section="Whole work" />,
    );
    expect(html).toContain(`href="/read/summary/${encodeURIComponent('sum:adapa-food-of-life')}"`);
    // A sum: id renders the generated-apparatus marker (todo:0f48f68a).
    expect(html).toContain('summary');
  });

  it('renders linkless without an id', () => {
    const html = renderToStaticMarkup(
      <Citation tradition="taoism" text="Tao Te Ching" section="48" />,
    );
    expect(html).not.toContain('<a');
    expect(html).toContain('Tao Te Ching');
  });
});
