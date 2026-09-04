/**
 * src/__tests__/provider-display.test.ts
 *
 * Unit tests for the provider-display module — slug → display
 * metadata + reverse-mapping from a resolved OpenRouter id.
 *
 * Spec: todo:e8105324 — model-picker UX simplification.
 */

import { describe, it, expect } from 'vitest';
import {
  PROVIDER_DISPLAY,
  providerSlugFromModelId,
  displayForModelId,
} from '@/lib/provider-display';
import { CURATED_MODELS } from '@/lib/curated-models';

describe('PROVIDER_DISPLAY', () => {
  it('has an entry for every CURATED_MODELS slug', () => {
    for (const slug of Object.keys(CURATED_MODELS)) {
      expect(PROVIDER_DISPLAY).toHaveProperty(slug);
    }
  });

  it('every entry has name, color, and a positive integer questionsPerDay', () => {
    for (const [slug, d] of Object.entries(PROVIDER_DISPLAY)) {
      expect(d.name, slug).toMatch(/^[A-Za-z.]+$/);              // no version strings
      expect(d.color, slug).toMatch(/^#[0-9a-f]{6}$/i);          // hex color
      expect(d.questionsPerDay, slug).toBeGreaterThan(0);
      expect(Number.isInteger(d.questionsPerDay), slug).toBe(true);
    }
  });

  it('provider colors are distinct (chips must be visually separable)', () => {
    // Guards todo:12d143f6 — colors are explicit hexes decoupled from
    // tokens.tradition, so a palette rekey can't collapse two providers
    // onto the same hue (OpenAI green vs Anthropic amber).
    const colors = Object.values(PROVIDER_DISPLAY).map((d) => d.color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  // The default (deepseek) must stay economical, but it is no longer
  // required to be *strictly* the cheapest. A promo-priced, agentic-
  // coding-tuned model (Gemini Flash) can temporarily undercut it on
  // raw per-query cost without being the right default for Guru's
  // retrieval workload — so the guardrail is "default stays in the two
  // most economical curated options", which catches the default
  // silently drifting expensive without pinning it to a promo price.
  it('default (deepseek) stays among the two most economical options', () => {
    const ranked = Object.values(PROVIDER_DISPLAY)
      .map((d) => d.questionsPerDay)
      .sort((a, b) => b - a);
    const secondBest = ranked[1]!;
    expect(PROVIDER_DISPLAY.deepseek.questionsPerDay).toBeGreaterThanOrEqual(secondBest);
  });

  // Lock the derivation: questionsPerDay must come from
  // PRO_DAILY_USD_CAP ÷ per-query cost (FALLBACK_PRICING + typical
  // tokens), not a hand-edited literal. This catches the
  // refactor-regression where someone reintroduces a static number.
  it('questionsPerDay is computed from pricing-config + FALLBACK_PRICING', async () => {
    const cfg = await import('@/lib/pricing-config');
    const { FALLBACK_PRICING } = await import('@/lib/fallback-pricing');

    for (const [slug, d] of Object.entries(PROVIDER_DISPLAY)) {
      const modelId = CURATED_MODELS[slug as keyof typeof CURATED_MODELS];
      const fb = FALLBACK_PRICING[modelId];
      expect(fb, `${slug} → ${modelId} missing from FALLBACK_PRICING`).toBeDefined();
      const perQueryCost =
        (cfg.TYPICAL_INPUT_TOKENS  / 1e6) * fb!.input_per_mtok +
        (cfg.TYPICAL_OUTPUT_TOKENS / 1e6) * fb!.output_per_mtok;
      // Floor, not round — see provider-display.ts comment. The
      // displayed "~N" must match what users can actually do
      // before cap binds; rounding up overpromises.
      const expected = Math.floor(cfg.PRO_DAILY_USD_CAP / perQueryCost);
      expect(d.questionsPerDay, slug).toBe(expected);
    }
  });

  // Sanity bounds — separate from the derivation test so a flipped
  // formula (round, ceil, etc.) that compiles cleanly still gets
  // caught by the order-of-magnitude check. Ranges reflect BRD §3.2
  // expectations under the current $5/30d cap, calibrated to real
  // OpenRouter list prices (deepseek ~9, xai ~5, google ~11,
  // anthropic ~4, openai ~3). Bump if the policy or list prices move
  // materially — headroom absorbs routine price drift.
  it('questionsPerDay falls in expected ranges per provider', () => {
    expect(PROVIDER_DISPLAY.deepseek.questionsPerDay).toBeGreaterThanOrEqual(6);
    expect(PROVIDER_DISPLAY.deepseek.questionsPerDay).toBeLessThanOrEqual(14);
    expect(PROVIDER_DISPLAY.xai.questionsPerDay).toBeGreaterThanOrEqual(3);
    expect(PROVIDER_DISPLAY.xai.questionsPerDay).toBeLessThanOrEqual(8);
    expect(PROVIDER_DISPLAY.google.questionsPerDay).toBeGreaterThanOrEqual(8);
    expect(PROVIDER_DISPLAY.google.questionsPerDay).toBeLessThanOrEqual(16);
    expect(PROVIDER_DISPLAY.anthropic.questionsPerDay).toBeGreaterThanOrEqual(2);
    expect(PROVIDER_DISPLAY.anthropic.questionsPerDay).toBeLessThanOrEqual(6);
    expect(PROVIDER_DISPLAY.openai.questionsPerDay).toBeGreaterThanOrEqual(2);
    expect(PROVIDER_DISPLAY.openai.questionsPerDay).toBeLessThanOrEqual(6);
  });
});

describe('providerSlugFromModelId()', () => {
  it('maps every current CURATED_MODELS id back to its slug', () => {
    for (const [slug, id] of Object.entries(CURATED_MODELS)) {
      expect(providerSlugFromModelId(id), id).toBe(slug);
    }
  });

  it('handles the x-ai → xai prefix translation', () => {
    expect(providerSlugFromModelId('x-ai/grok-4.3')).toBe('xai');
    expect(providerSlugFromModelId('x-ai/grok-99-future')).toBe('xai'); // version-bump robust
  });

  it('returns null for unknown providers', () => {
    expect(providerSlugFromModelId('meta-llama/llama-3.3-70b')).toBeNull();
    expect(providerSlugFromModelId('qwen/qwen3-max')).toBeNull();
    expect(providerSlugFromModelId('not/a/real/id')).toBeNull();
    expect(providerSlugFromModelId('')).toBeNull();
  });

  it('is robust to model-version bumps within a known provider', () => {
    // The whole point of the slug indirection — slug stays stable
    // when the resolved id changes.
    expect(providerSlugFromModelId('anthropic/claude-sonnet-99')).toBe('anthropic');
    expect(providerSlugFromModelId('openai/gpt-99-future')).toBe('openai');
    expect(providerSlugFromModelId('deepseek/deepseek-v99-pro')).toBe('deepseek');
    expect(providerSlugFromModelId('google/gemini-99-flash')).toBe('google');
  });
});

describe('displayForModelId()', () => {
  it('returns the matching display block for a curated id', () => {
    const d = displayForModelId('anthropic/claude-sonnet-4.6');
    expect(d?.name).toBe('Anthropic');
    expect(d?.color).toMatch(/^#/);
  });

  it('returns null for null/undefined/empty input (guards the chat-view render)', () => {
    expect(displayForModelId(null)).toBeNull();
    expect(displayForModelId(undefined)).toBeNull();
    expect(displayForModelId('')).toBeNull();
  });

  it('returns null for non-curated providers (legacy rows)', () => {
    expect(displayForModelId('meta-llama/llama-2-7b')).toBeNull();
  });
});
