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

  it('default (deepseek) has the highest questionsPerDay', () => {
    const counts = Object.values(PROVIDER_DISPLAY).map((d) => d.questionsPerDay);
    expect(PROVIDER_DISPLAY.deepseek.questionsPerDay).toBe(Math.max(...counts));
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
    expect(providerSlugFromModelId('google/gemini-2.5-pro')).toBeNull();
    expect(providerSlugFromModelId('not/a/real/id')).toBeNull();
    expect(providerSlugFromModelId('')).toBeNull();
  });

  it('is robust to model-version bumps within a known provider', () => {
    // The whole point of the slug indirection — slug stays stable
    // when the resolved id changes.
    expect(providerSlugFromModelId('anthropic/claude-sonnet-99')).toBe('anthropic');
    expect(providerSlugFromModelId('openai/gpt-99-future')).toBe('openai');
    expect(providerSlugFromModelId('deepseek/deepseek-v99-pro')).toBe('deepseek');
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
