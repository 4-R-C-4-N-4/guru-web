/**
 * src/__tests__/tier-source-of-truth.test.ts
 *
 * Regression for todo:c19a7b6b. The Stripe webhook
 * (/api/webhooks/stripe → handleCheckoutCompleted) writes
 * `users.tier='pro'` in Postgres. Nothing in this repo mirrors that into
 * Clerk's user.publicMetadata, so any UI that reads
 * `user.publicMetadata.tier` shows 'free' forever for upgraded users.
 *
 * Lock the source of truth: tier-display components must read from
 * /api/quota (which already returns the Postgres value), not from
 * Clerk metadata.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = {
  account: resolve(__dirname, '../app/(app)/account/page.tsx'),
  navbar:  resolve(__dirname, '../components/nav-bar.tsx'),
} as const;

function read(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('tier source of truth', () => {
  it('account page does not read user.publicMetadata.tier', () => {
    expect(read(FILES.account)).not.toMatch(/publicMetadata\??\.tier/);
  });

  it('account page fetches /api/quota and uses its tier field', () => {
    const src = read(FILES.account);
    expect(src).toMatch(/fetch\(\s*['"]\/api\/quota['"]/);
    expect(src).toMatch(/quota\??\.tier/);
  });

  it('nav-bar does not read user.publicMetadata.tier', () => {
    expect(read(FILES.navbar)).not.toMatch(/publicMetadata\??\.tier/);
  });

  it('nav-bar fetches /api/quota for tier', () => {
    const src = read(FILES.navbar);
    expect(src).toMatch(/fetch\(\s*['"]\/api\/quota['"]/);
  });
});
