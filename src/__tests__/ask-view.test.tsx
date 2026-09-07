/**
 * src/__tests__/ask-view.test.tsx
 *
 * Public anonymous ask surface (todo:f138c9ad). Static-render assertions
 * (react-dom/server, matching the share-public test style — no jsdom in
 * this project) over the initial UI and the signup wall. The streaming
 * fetch behaviour is exercised end-to-end at the API layer in
 * guest-query.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AskView from '@/components/ask-view';
import GuestWall from '@/components/guest-wall';

describe('AskView (initial render)', () => {
  it('shows the "Ask Guru anything" prompt and a composer, with no wall yet', () => {
    const html = renderToStaticMarkup(<AskView />);
    expect(html).toContain('Ask Guru anything');
    expect(html).toContain('<textarea');
    expect(html).toContain('>Ask</button>');
    // The wall only appears after the free question is spent.
    expect(html).not.toContain('Free question used');
  });
});

describe('GuestWall', () => {
  it('renders the default CTA with create-account and sign-in actions', () => {
    const html = renderToStaticMarkup(<GuestWall />);
    expect(html).toContain('Free question used');
    expect(html).toContain('Create free account');
    expect(html).toContain('href="/sign-up"');
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain('Create a free account to keep exploring Guru.');
  });

  it('renders a server-supplied message (e.g. the 429 copy) when given one', () => {
    const html = renderToStaticMarkup(<GuestWall message="You've used your free question." />);
    expect(html).toContain("You&#x27;ve used your free question.");
  });
});
