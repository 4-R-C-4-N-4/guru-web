/**
 * src/__tests__/share-public.test.tsx
 *
 * Public shared-chat surface (todo:47067537):
 *  - chat-public.ts must never return a revoked share (query-layer gate,
 *    the blog-public.ts contract),
 *  - /share/[slug] renders the snapshot read-only — CITATIONS tail
 *    stripped, cards from snapshot citations with parsed-block fallback
 *    (chat-view's rule), notFound on unknown/revoked slug,
 *  - metadata carries robots noindex.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// -- chat-public: gate at the query layer ----------------------------------

vi.mock('@/lib/db', () => ({ one: vi.fn(), query: vi.fn(), exec: vi.fn() }));
// Host gate + Clerk hooks: clerkEnabled defaults to false (tailnet shape —
// no ContinueButton); the button test flips it on. useUser/useRouter are
// stubbed because renderToStaticMarkup has no ClerkProvider/App Router.
vi.mock('@/lib/host', () => ({ clerkEnabled: vi.fn(async () => false) }));
vi.mock('@clerk/nextjs', () => ({ useUser: () => ({ isSignedIn: false }) }));
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return { ...actual, useRouter: () => ({ push: vi.fn() }) };
});

import { one } from '@/lib/db';
import { clerkEnabled } from '@/lib/host';
import { getShareBySlug } from '@/lib/chat-public';
import type { PublicShare } from '@/lib/chat-public';

const mOne = one as MockedFunction<typeof one>;
const mClerkEnabled = clerkEnabled as MockedFunction<typeof clerkEnabled>;

beforeEach(() => vi.clearAllMocks());

describe('getShareBySlug', () => {
  it('only queries non-revoked shares (revoked_at IS NULL in SQL)', async () => {
    mOne.mockResolvedValue(null);
    await getShareBySlug('some-slug');
    const sql = mOne.mock.calls[0]![0] as string;
    expect(sql).toMatch(/revoked_at IS NULL/);
    expect(mOne.mock.calls[0]![1]).toEqual(['some-slug']);
  });

  it('returns null for unknown or revoked slugs alike', async () => {
    mOne.mockResolvedValue(null);
    expect(await getShareBySlug('gone')).toBeNull();
  });

  it('normalizes a malformed messages payload to an empty array', async () => {
    mOne.mockResolvedValue({ slug: 's', messages: null } as never);
    const share = await getShareBySlug('s');
    expect(share?.messages).toEqual([]);
  });

  it('normalizes per-message citations so consumers never see undefined', async () => {
    mOne.mockResolvedValue({
      slug: 's',
      messages: [{ query_text: 'q', response_text: 'r', created_at: 't' }], // no citations key
    } as never);
    const share = await getShareBySlug('s');
    expect(share?.messages[0]!.citations).toEqual([]);
  });
});

// -- /share/[slug] page ------------------------------------------------------
// No chat-public mock: the page goes through the REAL getShareBySlug onto the
// mocked db layer, so these tests also pin the row → PublicShare plumbing.

import SharePage, { generateMetadata } from '@/app/share/[slug]/page';

const BASE: PublicShare = {
  id: 'sh1',
  slug: 'abc123',
  title: 'On the Demiurge',
  voice: 'scholar',
  mode: 'chat',
  study_text_id: null,
  retrieval_scope: {
    scopeMode: 'all',
    blockedTraditions: [], blockedTexts: [],
    whitelistedTraditions: [], whitelistedTexts: [],
  },
  created_at: '2026-07-11T00:00:00Z',
  messages: [],
};

async function render(share: PublicShare): Promise<string> {
  mOne.mockResolvedValue(share as never); // the db row IS the PublicShare shape
  const el = await SharePage({ params: Promise.resolve({ slug: share.slug }) });
  return renderToStaticMarkup(el);
}

describe('share page', () => {
  it('renders turns read-only: prompt, response with CITATIONS tail stripped, snapshot citation cards', async () => {
    const html = await render({
      ...BASE,
      messages: [{
        query_text: 'What is the demiurge?',
        response_text: 'The craftsman of the cosmos.\n\nCITATIONS:\n[gnosticism | Apocryphon of John | II.5 | TIER: verified]',
        created_at: 't1',
        citations: [{ id: 'c1', tradition: 'gnosticism', text: 'Gospel of Philip', section: '78', tier: 'verified' }],
      }],
    });
    expect(html).toContain('On the Demiurge');          // heading from snapshot title
    expect(html).toContain('What is the demiurge?');    // user turn
    expect(html).toContain('craftsman of the cosmos');  // assistant prose
    expect(html).not.toContain('CITATIONS:');            // tail stripped
    expect(html).toContain('Gospel of Philip');          // card from snapshot citations…
    expect(html).not.toContain('Apocryphon of John');    // …which win over the parsed tail
  });

  it('falls back to the parsed CITATIONS tail when the snapshot has no citations (chat-view rule)', async () => {
    const html = await render({
      ...BASE,
      messages: [{
        query_text: 'q',
        response_text: 'Prose.\n\nCITATIONS:\n[taoism | Tao Te Ching | 1 | TIER: verified]',
        created_at: 't1',
        citations: [],
      }],
    });
    expect(html).toContain('Tao Te Ching');
    expect(html).not.toContain('CITATIONS:');
  });

  it('404s (notFound) on unknown or revoked slugs', async () => {
    mOne.mockResolvedValue(null);
    await expect(
      SharePage({ params: Promise.resolve({ slug: 'nope' }) }),
    ).rejects.toThrow(); // next/navigation notFound() throws NEXT_HTTP_ERROR_FALLBACK
  });

  it('metadata sets robots noindex and falls back to a generic title', async () => {
    mOne.mockResolvedValue({ ...BASE, title: null } as never);
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'abc123' }) });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe('Shared conversation — Guru');
  });

  it('omits the Continue button when Clerk is disabled (tailnet host)', async () => {
    const html = await render(BASE); // clerkEnabled mock defaults to false
    expect(html).not.toContain('Continue this conversation');
  });

  it('renders the Continue button when Clerk is enabled', async () => {
    mClerkEnabled.mockResolvedValueOnce(true);
    const html = await render(BASE);
    expect(html).toContain('Continue this conversation');
    expect(html).toContain('sign in'); // signed-out hint under the button
  });
});

// -- continue-button auth-flow contracts --------------------------------------
// The live behaviour (Clerk redirect, history.replaceState, sessionStorage)
// needs a browser; what this file can defend is the source contract — the
// same approach as sign-in-redirect-prop.test.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

describe('continue-button source contract', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../components/continue-button.tsx'),
    'utf8',
  );

  it('signed-out path bounces through /sign-in with a redirect back to ?continue=1', () => {
    expect(src).toMatch(/\/share\/\$\{slug\}\?continue=1/);
    expect(src).toMatch(/\/sign-in\?redirect_url=/);
  });

  it('auto-fork strips the param (refresh-safe) and dedupes via sessionStorage (bfcache-safe)', () => {
    expect(src).toMatch(/params\.delete\('continue'\)/);
    expect(src).toMatch(/history\.replaceState/);
    expect(src).toMatch(/sessionStorage\.(get|set)Item/);
  });

  it('waits for Clerk to resolve before consuming the param', () => {
    expect(src).toMatch(/if \(!isSignedIn\) return;/);
  });

  it('forwards a voice downgrade to the forked chat as a notice param (say-but-downgrade)', () => {
    expect(src).toMatch(/voiceDowngraded/);
    expect(src).toMatch(/\/chat\/\$\{forked\.sessionId\}\$\{notice\}/);
  });
});
