/**
 * src/__tests__/essay-card.test.ts
 *
 * EssayCard is hook-free and presentational, so we can call it as a plain
 * function and walk the returned React element tree (no jsdom needed under the
 * 'node' test environment). Guards the two things both the /blog index and the
 * homepage feed depend on: the card links to /blog/<slug>, and it shows the
 * title plus the dek (omitting the dek paragraph when there is none).
 */
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import EssayCard from '@/components/essay-card';
import type { PublishedListItem } from '@/lib/blog-public';

// Collect every string leaf in a rendered element tree.
function textOf(node: ReactNode): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const props = (n as { props?: { children?: unknown } }).props;
    if (props?.children !== undefined) walk(props.children);
  };
  walk(node);
  return out.join(' ');
}

const post: PublishedListItem = {
  title: 'The Cord That Cannot Be Cut',
  slug: 'the-cord',
  dek: 'A line about the cord.',
  published_at: '2026-06-03',
};

describe('EssayCard', () => {
  it('links to /blog/<slug>', () => {
    const el = EssayCard({ post }) as { props: { href: string } };
    expect(el.props.href).toBe('/blog/the-cord');
  });

  it('renders the title and dek', () => {
    const text = textOf(EssayCard({ post }));
    expect(text).toContain('The Cord That Cannot Be Cut');
    expect(text).toContain('A line about the cord.');
  });

  it('omits the dek when there is none', () => {
    const text = textOf(EssayCard({ post: { ...post, dek: null } }));
    expect(text).toContain('The Cord That Cannot Be Cut');
    expect(text).not.toContain('A line about the cord.');
  });
});
