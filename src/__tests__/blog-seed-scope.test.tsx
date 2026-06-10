/**
 * src/__tests__/blog-seed-scope.test.tsx
 *
 * Regression for todo:c2b401a2 — the blog seed-form only exposed a blacklist
 * ("block traditions"), so a post could never be RESTRICTED to a chosen set of
 * traditions (the whitelist path existed end-to-end in the backend but no UI
 * sent it). buildScopePayload is the seam the new Block / Limit-to toggle uses;
 * these assert the contract the seed route validates.
 */

import { describe, it, expect } from 'vitest';
import { buildScopePayload } from '@/app/(admin)/admin/blog/seed-form';

describe('buildScopePayload', () => {
  it('limit-to mode → whitelist scope restricted to the checked traditions', () => {
    const p = buildScopePayload('limit', ['taoism', 'hermeticism']);
    expect(p.scope_mode).toBe('whitelist');
    expect(p.whitelisted_traditions).toEqual(['taoism', 'hermeticism']);
    expect(p.blocked_traditions).toEqual([]); // never carry a stale blacklist
  });

  it('block mode → blacklist scope excluding the checked traditions', () => {
    const p = buildScopePayload('block', ['zoroastrianism', 'western_esoteric']);
    expect(p.scope_mode).toBe('blacklist');
    expect(p.blocked_traditions).toEqual(['zoroastrianism', 'western_esoteric']);
    expect(p.whitelisted_traditions).toEqual([]);
  });

  it('empty selection → scope_mode "all" regardless of kind', () => {
    for (const kind of ['block', 'limit'] as const) {
      const p = buildScopePayload(kind, []);
      expect(p.scope_mode).toBe('all');
      expect(p.blocked_traditions).toEqual([]);
      expect(p.whitelisted_traditions).toEqual([]);
    }
  });
});
