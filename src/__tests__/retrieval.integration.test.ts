/**
 * src/__tests__/retrieval.integration.test.ts
 *
 * Golden-query integration tests for the full retrieval pipeline.
 * Requires a seeded local Postgres (npm run migrate && npm run seed-dev).
 *
 * Skipped automatically unless INTEGRATION_TEST=1 is set, so CI passes
 * without a live database.
 *
 * Run locally:
 *   DATABASE_URL=postgresql://guru:guru_dev@localhost:5432/guru \
 *   OPENROUTER_API_KEY=sk-... \
 *   INTEGRATION_TEST=1 \
 *   npx vitest run src/__tests__/retrieval.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';

const SKIP = !process.env.INTEGRATION_TEST;

describe.skipIf(SKIP)('Retrieval pipeline — integration', () => {
  // Lazy imports so the module-level db pool is not created unless we're actually running
  let retrieve: typeof import('@/lib/retriever').retrieve;
  let buildPrompt: typeof import('@/lib/prompt').buildPrompt;

  const PREFS = {
    scopeMode: 'all' as const,
    blockedTraditions: [],
    blockedTexts: [],
    whitelistedTraditions: [],
    whitelistedTexts: [],
  };

  beforeAll(async () => {
    const retrieverMod = await import('@/lib/retriever');
    const promptMod    = await import('@/lib/prompt');
    retrieve    = retrieverMod.retrieve;
    buildPrompt = promptMod.buildPrompt;
  });

  it('golden query: "divine spark" returns chunks from seeded corpus', async () => {
    const chunks = await retrieve('divine spark', PREFS, 5);
    expect(chunks.length).toBeGreaterThan(0);
    // Should include at least one Gnosticism chunk (gt-77 in seed data)
    const traditions = chunks.map(c => c.tradition);
    expect(traditions).toContain('gnosticism');
  }, 30_000);

  it('golden query: "atman brahman" returns Vedanta chunks', async () => {
    const chunks = await retrieve('atman brahman', PREFS, 5);
    expect(chunks.length).toBeGreaterThan(0);
    const traditions = chunks.map(c => c.tradition);
    expect(traditions).toContain('vedanta');
  }, 30_000);

  it('buildPrompt produces a non-empty prompt with citations', async () => {
    const chunks = await retrieve('divine spark light', PREFS, 5);
    const prompt = buildPrompt('What is the divine spark?', chunks, PREFS, 'free');
    expect(prompt).toContain('SOURCE PASSAGES');
    expect(prompt).toContain('What is the divine spark?');
    expect(prompt.length).toBeGreaterThan(100);
  }, 30_000);

  it('scope blacklist filters out blocked traditions', async () => {
    const prefsBlocked = {
      ...PREFS,
      scopeMode: 'blacklist' as const,
      blockedTraditions: ['gnosticism'],
    };
    const chunks = await retrieve('divine spark', prefsBlocked, 10);
    const traditions = chunks.map(c => c.tradition);
    expect(traditions).not.toContain('gnosticism');
  }, 30_000);
});
