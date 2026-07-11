/**
 * src/__tests__/blog-nav.test.tsx
 *
 * Guards for connecting the isolated blog to the main site (todo:25ec2f4c):
 *  - BlogHomeButton is auth-aware: signed-in readers return to /chat, anonymous
 *    visitors land on /sign-in (todo:3eb7c659).
 *  - NAV_ITEMS exposes an Essays -> /blog entry so a logged-in user can reach
 *    the blog from the nav; the array drives both the desktop row and the
 *    mobile dropdown (todo:133d94d6).
 *  - The shared blog layout actually mounts the button, so every blog route
 *    inherits the exit affordance.
 *
 * The button is rendered statically (react-dom/server) with Clerk's useUser
 * mocked, mirroring the chat-citations render style. NAV/layout wiring uses
 * the source-level guard style from nav-bar.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const mockAuth = vi.hoisted(() => ({ isSignedIn: false as boolean | undefined }));
vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isSignedIn: mockAuth.isSignedIn }),
}));

const mockHost = vi.hoisted(() => ({ value: 'app.guru-ai.org' as string | null }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'host' ? mockHost.value : null) }),
}));

import BlogHomeButton from '@/components/blog-home-button';
import BlogLayout from '@/app/blog/layout';
import { TAILNET_HOST } from '@/lib/host';

describe('BlogHomeButton auth-aware target (todo:3eb7c659)', () => {
  it('points anonymous visitors at /sign-in', () => {
    mockAuth.isSignedIn = false;
    const html = renderToStaticMarkup(<BlogHomeButton />);
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain('href="/chat"');
  });

  it('points signed-in readers back into the app at /chat', () => {
    mockAuth.isSignedIn = true;
    const html = renderToStaticMarkup(<BlogHomeButton />);
    expect(html).toContain('href="/chat"');
  });

  it('defaults to /sign-in while Clerk is still loading (isSignedIn undefined)', () => {
    mockAuth.isSignedIn = undefined;
    const html = renderToStaticMarkup(<BlogHomeButton />);
    expect(html).toContain('href="/sign-in"');
  });
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const NAV_SRC = readFileSync(resolve(__dirname, '../components/nav-bar.tsx'), 'utf8');
const LAYOUT_SRC = readFileSync(resolve(__dirname, '../app/blog/layout.tsx'), 'utf8');

describe('blog reachable from the logged-in UI (todo:133d94d6)', () => {
  it('NAV_ITEMS includes an Essays -> /blog entry', () => {
    expect(NAV_SRC).toMatch(/href:\s*['"]\/blog['"]\s*,\s*label:\s*['"]Essays['"]/);
  });

  it('mobile dropdown maps MOBILE_MENU_ITEMS (a NAV_ITEMS superset), so Essays is reachable on mobile too', () => {
    // Since the header rework (todo:063efee7) mobile maps MOBILE_MENU_ITEMS,
    // which spreads NAV_ITEMS — Essays still rides along.
    expect(NAV_SRC).toMatch(/MOBILE_MENU_ITEMS\s*=\s*\[\s*\.\.\.NAV_ITEMS/);
    expect(NAV_SRC).toMatch(/mobile && menuOpen[\s\S]{0,400}MOBILE_MENU_ITEMS\.map/);
  });
});

describe('shared blog layout mounts the home button (todo:3eb7c659)', () => {
  it('blog/layout.tsx renders BlogHomeButton', () => {
    expect(LAYOUT_SRC).toMatch(/import\s+BlogHomeButton/);
    expect(LAYOUT_SRC).toMatch(/<BlogHomeButton\s*\/>/);
  });
});

describe('blog layout degrades gracefully on the tailnet host (todo:3eb7c659)', () => {
  // The root layout skips ClerkProvider on the tailnet host, so calling the
  // useUser() hook there throws. The blog is public and must still render —
  // the layout falls back to a static link instead of the Clerk-driven button.
  it('renders a static home link to / (no Clerk hook) when ClerkProvider is absent', async () => {
    mockHost.value = TAILNET_HOST;
    const html = renderToStaticMarkup(await BlogLayout({ children: null }));
    expect(html).toContain('href="/"');
    expect(html).toContain('← Home');
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain('href="/chat"');
  });

  it('mounts the auth-aware BlogHomeButton on a normal host', async () => {
    mockHost.value = 'app.guru-ai.org';
    mockAuth.isSignedIn = true;
    const html = renderToStaticMarkup(await BlogLayout({ children: null }));
    expect(html).toContain('href="/chat"');
  });
});
