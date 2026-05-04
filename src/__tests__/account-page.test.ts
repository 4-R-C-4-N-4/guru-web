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
});

describe('account page subscription management (todo:7854e1ba)', () => {
  it('POSTs to /api/portal to open the Stripe Customer Portal', () => {
    expect(SRC).toMatch(/fetch\(\s*['"]\/api\/portal['"]\s*,\s*\{\s*method:\s*['"]POST['"]/);
  });

  it('renders a MANAGE SUBSCRIPTION button on the Pro card for current Pro users', () => {
    // The button text should be present, and it should be wired to the
    // portal handler (not the upgrade handler).
    expect(SRC).toMatch(/MANAGE SUBSCRIPTION/);
    expect(SRC).toMatch(/onClick=\{handleManageSubscription\}/);
  });
});
