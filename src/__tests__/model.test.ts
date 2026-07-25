/**
 * src/__tests__/model.test.ts
 *
 * Unit tests for the curated model picker map + helpers. The
 * map itself is the contract: slug names, the four picker
 * providers, and the default. Tests lock those values so an
 * accidental rename or omission fails CI.
 *
 * Spec: BRD-model-selection.md §4.2, §5.1.
 */

import { describe, it, expect } from 'vitest';
import {
  CURATED_MODELS,
  DEFAULT_CURATED_SLUG,
  resolveCuratedModel,
  isCuratedSlug,
  type CuratedSlug,
} from '@/lib/curated-models';

describe('CURATED_MODELS', () => {
  it('has exactly five picker entries — one per provider', () => {
    expect(Object.keys(CURATED_MODELS).sort()).toEqual([
      'anthropic', 'deepseek', 'google', 'openai', 'xai',
    ]);
  });

  it('every slug maps to a fully-qualified OpenRouter id', () => {
    for (const [slug, id] of Object.entries(CURATED_MODELS)) {
      // OpenRouter ids are <provider>/<model>. The provider portion
      // doesn't have to match the slug (slug 'xai' resolves to
      // 'x-ai/grok-4.3', for example), but the structure has to be
      // <something>/<something>.
      expect(id, `${slug} → ${id}`).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
    }
  });

  it('DEFAULT_CURATED_SLUG is a real slug in the map', () => {
    expect(CURATED_MODELS[DEFAULT_CURATED_SLUG]).toBeDefined();
  });

  it('DEFAULT_CURATED_SLUG is "deepseek" (the cheap floor — BRD §1)', () => {
    expect(DEFAULT_CURATED_SLUG).toBe('deepseek');
  });
});

describe('resolveCuratedModel()', () => {
  it('returns the OpenRouter id for each slug', () => {
    expect(resolveCuratedModel('deepseek')).toBe('deepseek/deepseek-v4-pro');
    expect(resolveCuratedModel('xai')).toBe('x-ai/grok-4.3');
    expect(resolveCuratedModel('google')).toBe('google/gemini-3.6-flash');
    expect(resolveCuratedModel('anthropic')).toBe('anthropic/claude-sonnet-5');
    expect(resolveCuratedModel('openai')).toBe('openai/gpt-5.6-terra');
  });

  it('throws on a slug not in the map (defensive against stale prefs)', () => {
    expect(() => resolveCuratedModel('unknown' as CuratedSlug)).toThrow(/Unknown CURATED_MODELS slug/);
  });
});

describe('isCuratedSlug()', () => {
  it('returns true for every current slug', () => {
    for (const slug of Object.keys(CURATED_MODELS)) {
      expect(isCuratedSlug(slug)).toBe(true);
    }
  });

  it('returns false for unknown strings, null, undefined, numbers', () => {
    expect(isCuratedSlug('frontier-anthropic')).toBe(false);  // old-style
    expect(isCuratedSlug('Anthropic')).toBe(false);            // case-sensitive
    expect(isCuratedSlug('')).toBe(false);
    expect(isCuratedSlug(null)).toBe(false);
    expect(isCuratedSlug(undefined)).toBe(false);
    expect(isCuratedSlug(42)).toBe(false);
    expect(isCuratedSlug({})).toBe(false);
  });

  it('narrows the type for the caller', () => {
    const v: unknown = 'anthropic';
    if (isCuratedSlug(v)) {
      // Compile-time: v is now CuratedSlug, indexable into the map.
      const id: string = CURATED_MODELS[v];
      expect(id).toBe('anthropic/claude-sonnet-5');
    }
  });
});
