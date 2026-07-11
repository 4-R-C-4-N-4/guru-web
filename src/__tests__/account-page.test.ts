/**
 * src/__tests__/account-page.test.ts
 *
 * Source-level guards for the /account page's plan cards (todo:23153adc).
 * The Free plan's "N queries/day" bullet must be derived from
 * FREE_DAILY_QUERY_LIMIT in pricing-config.ts, not hardcoded — otherwise
 * the marketing copy silently drifts from the server-enforced cap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../app/(app)/account/page.tsx'), 'utf8');

describe('account page plan cards', () => {
  it('imports FREE_DAILY_QUERY_LIMIT from pricing-config', () => {
    expect(SRC).toMatch(/import\s*\{[^}]*\bFREE_DAILY_QUERY_LIMIT\b[^}]*\}\s*from\s*['"]@\/lib\/pricing-config['"]/);
  });

  it('Free bullet interpolates the constant, never a literal queries/day', () => {
    // The Free features array must contain a template literal that uses
    // FREE_DAILY_QUERY_LIMIT, and must NOT contain a hardcoded
    // "N queries/day" string (e.g. the old "30 queries/day").
    expect(SRC).toMatch(/\$\{FREE_DAILY_QUERY_LIMIT\}\s*queries\/day/);
    expect(SRC).not.toMatch(/['"][0-9]+\s*queries\/day['"]/);
  });

  it('imports PRO_MONTHLY_PRICE_USD and interpolates it (todo:212682c6)', () => {
    // Pro price must come from the pricing-config constant, not a
    // hardcoded string. Was "$12/mo" — drifted from the locked $15
    // sticker price; same drift class as the FREE_DAILY_QUERY_LIMIT
    // guard above.
    expect(SRC).toMatch(/import\s*\{[^}]*\bPRO_MONTHLY_PRICE_USD\b[^}]*\}\s*from\s*['"]@\/lib\/pricing-config['"]/);
    expect(SRC).toMatch(/\$\{PRO_MONTHLY_PRICE_USD\}\/mo/);
    expect(SRC).not.toMatch(/['"]\$[0-9]+\/mo['"]/);
  });
});

describe('account page Pro bullets reflect the real product (todo:dffc2b19)', () => {
  it('does not advertise "Unlimited queries" — Pro is bounded by PRO_DAILY_USD_CAP', () => {
    expect(SRC).not.toMatch(/Unlimited queries/);
  });

  it('does not mention Citation export, Premium model, or Priority retrieval (vapor)', () => {
    expect(SRC).not.toMatch(/Citation export/);
    expect(SRC).not.toMatch(/Premium model/);
    expect(SRC).not.toMatch(/Priority retrieval/);
  });

  it('Pro features include the queries-multiplier and provider-choice bullets', () => {
    expect(SRC).toMatch(/3×\s*more queries per day/);
    expect(SRC).toMatch(/Choose your provider/);
  });
});

describe('account page Usage Today bar (todo:6e255bb7)', () => {
  it('Pro renders a count-only label, never with the runaway-loop denominator', () => {
    // Pro branch must render `${quota.used} today` and must NOT render the
    // misleading `/ ${quota.limit}` shape on the same branch.
    expect(SRC).toMatch(/tier\s*===\s*['"]pro['"]\s*\n?\s*\?\s*`\$\{quota\.used\}\s*today`/);
  });

  it('hides the progress bar for Pro (no real query-count denominator to fill)', () => {
    expect(SRC).toMatch(/tier\s*!==\s*['"]pro['"]\s*&&\s*\(/);
  });
});

describe('account page subscription management (todo:7854e1ba)', () => {
  it('POSTs to /api/portal to open the Stripe Customer Portal', () => {
    expect(SRC).toMatch(/fetch\(\s*['"]\/api\/portal['"]\s*,\s*\{\s*method:\s*['"]POST['"]/);
  });

  it('renders a Manage subscription button on the Pro card for current Pro users', () => {
    // The button text should be present (sentence case since the phase-2
    // copy pass, todo:54188aa3), and it should be wired to the portal
    // handler (not the upgrade handler).
    expect(SRC).toMatch(/Manage subscription/);
    expect(SRC).toMatch(/onClick=\{handleManageSubscription\}/);
  });
});
