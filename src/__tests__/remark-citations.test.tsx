/**
 * src/__tests__/remark-citations.test.tsx
 *
 * Inline citation linkification: literal `[Trad | Text | Section]` brackets
 * in assistant markdown must become links into /read when they resolve
 * against the message's citation set, and stay literal text when they
 * don't — a wrong link is worse than no link.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkCiteLinks, type CiteRef } from '@/lib/remark-citations';
import { MD_COMPONENTS } from '@/lib/markdown';

const CITES: CiteRef[] = [
  { id: 'neoplatonism.enneads-v.001', text: 'Enneads', section: 'V.1' },
  { id: 'sum:agrippa-natural-magic', text: 'Occult Philosophy', section: 'Whole work' },
];

function render(md: string, cites: CiteRef[] = CITES): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCiteLinks(cites)]} components={MD_COMPONENTS}>
      {md}
    </ReactMarkdown>,
  );
}

describe('remarkCiteLinks', () => {
  it('links a resolvable bracket to the chunk reader path', () => {
    const html = render('As Plotinus writes [Neoplatonism | Enneads | V.1], the One precedes being.');
    expect(html).toContain('href="/read/neoplatonism/enneads-v/001"');
    expect(html).toContain('[Neoplatonism | Enneads | V.1]');
  });

  it('matches case- and whitespace-insensitively', () => {
    const html = render('[neoplatonism |  ENNEADS  | v.1]');
    expect(html).toContain('href="/read/neoplatonism/enneads-v/001"');
  });

  it('tolerates an inline 4-field form with a TIER tail', () => {
    const html = render('[Neoplatonism | Enneads | V.1 | TIER: verified]');
    expect(html).toContain('href="/read/neoplatonism/enneads-v/001"');
  });

  it('routes summary citations to the summary page', () => {
    const html = render('[Hermeticism | Occult Philosophy | Whole work]');
    expect(html).toContain(`href="/read/summary/${encodeURIComponent('sum:agrippa-natural-magic')}"`);
  });

  it('leaves unresolvable brackets as literal text', () => {
    const html = render('An aside [not | a real | citation] stays put.');
    expect(html).not.toContain('<a');
    expect(html).toContain('[not | a real | citation]');
  });

  it('falls back to a unique text match when the section differs', () => {
    const html = render('[Neoplatonism | Enneads | V.9]');
    expect(html).toContain('href="/read/neoplatonism/enneads-v/001"');
  });

  it('does not fall back when the text match is ambiguous', () => {
    const cites: CiteRef[] = [
      { id: 'a.enneads.001', text: 'Enneads', section: 'I.1' },
      { id: 'a.enneads.002', text: 'Enneads', section: 'II.2' },
    ];
    const html = render('[Neoplatonism | Enneads | V.9]', cites);
    expect(html).not.toContain('<a');
  });

  it('renders internal citation links without target=_blank', () => {
    const html = render('[Neoplatonism | Enneads | V.1]');
    expect(html).not.toContain('target="_blank"');
  });
});
