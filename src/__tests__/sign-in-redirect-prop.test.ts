/**
 * src/__tests__/sign-in-redirect-prop.test.ts
 *
 * Source-level guard for the /sign-in and /sign-up Clerk component
 * props (todo:7069e9aa).
 *
 * Bug: both pages used `forceRedirectUrl="/chat"`, which makes Clerk
 * ALWAYS navigate to /chat after auth — even when the request URL
 * carries a `redirect_url` query param (e.g. /sign-in?redirect_url=/admin).
 *
 * The admin session-ceiling pattern in src/middleware.ts emits exactly
 * that redirect_url to bounce stale-session admins through a fresh
 * sign-in and back to /admin. With forceRedirectUrl set, the param was
 * dead code — admins ended up on /chat.
 *
 * Fix: `fallbackRedirectUrl` only fires when redirect_url is unset.
 * Direct sign-in / sign-up flows (no redirect_url) still land on /chat
 * via the fallback; the admin re-auth path's redirect_url now wins.
 *
 * Behaviour test isn't possible without spinning up Clerk's runtime —
 * the live behaviour lives entirely inside @clerk/nextjs. Pinning the
 * prop name in source is the contract this PR can defend.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PAGES: Array<[label: string, relPath: string]> = [
  ['sign-in', '../app/sign-in/[[...sign-in]]/page.tsx'],
  ['sign-up', '../app/sign-up/[[...sign-up]]/page.tsx'],
];

describe('sign-in / sign-up Clerk redirect prop', () => {
  it.each(PAGES)('%s page uses fallbackRedirectUrl', (_label, relPath) => {
    const src = readFileSync(resolve(__dirname, relPath), 'utf8');
    expect(src).toMatch(/\bfallbackRedirectUrl\s*=\s*["']\/chat["']/);
  });

  it.each(PAGES)('%s page does NOT use forceRedirectUrl', (_label, relPath) => {
    const src = readFileSync(resolve(__dirname, relPath), 'utf8');
    expect(src).not.toMatch(/\bforceRedirectUrl\b/);
  });
});
