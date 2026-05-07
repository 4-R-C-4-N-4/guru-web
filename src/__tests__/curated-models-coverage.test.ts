/**
 * src/__tests__/curated-models-coverage.test.ts
 *
 * CI guard: every entry in CURATED_MODELS (src/lib/model.ts) must
 * have a matching entry in FALLBACK_PRICING (scripts/sync-pricing.ts).
 *
 * Why this matters: computeCost throws when no model_pricing row
 * covers the resolved id (src/lib/cost.ts:97). The production
 * model_pricing table is seeded by `npm run sync-pricing` against
 * OpenRouter, but if OpenRouter is unreachable when the script
 * runs (fresh-VPS bootstrap during an OR outage), it falls back to
 * FALLBACK_PRICING. So:
 *
 *   - Every curated id needs a row in model_pricing eventually.
 *   - On a fresh VPS during an OR outage, FALLBACK_PRICING is the
 *     only seed source.
 *   - If we add a slug to CURATED_MODELS but forget to add the
 *     paired FALLBACK_PRICING entry, the live path can 500 with
 *     "No model_pricing row for X" the moment that picker option
 *     is selected.
 *
 * This test catches that mistake at PR time. Spec:
 * BRD-model-selection.md §8.3, IMPL §4.
 *
 * For drift in actual upstream prices (OpenRouter changed Sonnet's
 * rate), the daily systemd timer (deploy/sync-pricing.timer) is the
 * mitigation — out of scope for this test.
 */

import { describe, it, expect } from 'vitest';
import { CURATED_MODELS, PREFERRED_PROVIDER, preferredProviderFor } from '@/lib/curated-models';
import { FALLBACK_PRICING } from '../../scripts/sync-pricing';

describe('CURATED_MODELS ↔ FALLBACK_PRICING coverage', () => {
  it('every curated slug has a matching fallback pricing entry', () => {
    const missing: string[] = [];
    for (const [slug, modelId] of Object.entries(CURATED_MODELS)) {
      if (!(modelId in FALLBACK_PRICING)) {
        missing.push(`${slug} → ${modelId}`);
      }
    }
    expect(
      missing,
      `Add the following ids to FALLBACK_PRICING in scripts/sync-pricing.ts:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('fallback prices are sane (positive numbers; cached <= input)', () => {
    for (const [modelId, price] of Object.entries(FALLBACK_PRICING)) {
      expect(price.input_per_mtok,  modelId).toBeGreaterThan(0);
      expect(price.output_per_mtok, modelId).toBeGreaterThan(0);
      if (price.cached_input_per_mtok !== null) {
        expect(price.cached_input_per_mtok, modelId).toBeGreaterThan(0);
        // Cached should always be cheaper than fresh input — otherwise
        // why would a provider offer caching? Catches a transposed
        // value at PR review time.
        expect(price.cached_input_per_mtok, modelId).toBeLessThanOrEqual(price.input_per_mtok);
      }
    }
  });
});

describe('CURATED_MODELS ↔ PREFERRED_PROVIDER coverage', () => {
  it('every curated slug has a preferred provider mapping', () => {
    for (const slug of Object.keys(CURATED_MODELS)) {
      expect(PREFERRED_PROVIDER, slug).toHaveProperty(slug);
      expect(typeof PREFERRED_PROVIDER[slug as keyof typeof PREFERRED_PROVIDER]).toBe('string');
    }
  });

  it('preferredProviderFor returns the canonical name for each slug', () => {
    expect(preferredProviderFor('deepseek')).toBe('DeepSeek');
    expect(preferredProviderFor('xai')).toBe('xAI');
    expect(preferredProviderFor('anthropic')).toBe('Anthropic');
    expect(preferredProviderFor('openai')).toBe('OpenAI');
  });
});
