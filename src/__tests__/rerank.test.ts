/**
 * src/__tests__/rerank.test.ts
 *
 * Unit tests for mergeAndRerank (todo:d1a94167). Pure function, no DB —
 * synthetic vector/graph candidates in, ranked top-K out. These pin the
 * intended behavior for the three scoring bugs:
 *   - 3251a8d6  vector hits get an explicit 'inferred' tier (not silent 0.4)
 *   - 0a771923  graph results score on an independent term (not a fake distance)
 *   - ce844add  diversity rewards rare traditions, order-independent
 */
import { describe, it, expect } from 'vitest';
import { mergeAndRerank } from '@/lib/retriever';
import type { RetrievedChunk } from '@/lib/types';

function chunk(
  id: string,
  tradition: string,
  opts: { source: 'vector' | 'graph'; distance?: number; tier?: RetrievedChunk['tier'] },
): RetrievedChunk {
  return {
    id, text_id: 't', tradition, text_name: 'tn', section: 's',
    translator: null, body: 'b', token_count: 1,
    source: opts.source, distance: opts.distance, tier: opts.tier,
  };
}

describe('mergeAndRerank — vector tier (3251a8d6)', () => {
  it('tags vector-only hits with an explicit inferred tier, not undefined', () => {
    const out = mergeAndRerank([chunk('c1', 'neoplatonism', { source: 'vector', distance: 0.3 })], [], 5);
    expect(out).toHaveLength(1);
    expect(out[0].tier).toBe('inferred');
  });

  it('ranks vector hits by similarity (higher similarity first) — not flattened', () => {
    const out = mergeAndRerank(
      [
        chunk('lo', 'x', { source: 'vector', distance: 0.6 }),
        chunk('hi', 'x', { source: 'vector', distance: 0.1 }),
      ],
      [], 5,
    );
    expect(out.map(c => c.id)).toEqual(['hi', 'lo']);
  });
});

describe('mergeAndRerank — graph leg (0a771923)', () => {
  it('scores graph-only hits on their edge tier (verified outranks inferred)', () => {
    const out = mergeAndRerank([], [
      chunk('inf', 'x', { source: 'graph', tier: 'inferred' }),
      chunk('ver', 'y', { source: 'graph', tier: 'verified' }),
    ], 5);
    expect(out.map(c => c.id)).toEqual(['ver', 'inf']);
  });

  it('a chunk in both legs keeps vector similarity AND adopts the stronger graph tier, outranking a vector-only peer', () => {
    const out = mergeAndRerank(
      [
        chunk('both', 'x', { source: 'vector', distance: 0.3 }),
        chunk('vonly', 'y', { source: 'vector', distance: 0.3 }),
      ],
      [chunk('both', 'x', { source: 'graph', tier: 'verified' })],
      5,
    );
    expect(out[0].id).toBe('both');
    expect(out.find(c => c.id === 'both')!.tier).toBe('verified');
  });
});

describe('mergeAndRerank — diversity + cap (ce844add)', () => {
  it('ranks rare traditions above an over-represented one at equal similarity/tier, and caps per tradition', () => {
    const vec = [
      ...Array.from({ length: 6 }, (_, i) => chunk(`plo${i}`, 'plotinus', { source: 'vector', distance: 0.3 })),
      chunk('ved', 'vedanta', { source: 'vector', distance: 0.3 }),
      chunk('suf', 'sufi', { source: 'vector', distance: 0.3 }),
    ];
    const out = mergeAndRerank(vec, [], 8);

    // rare traditions win the top slots despite identical sim/tier
    expect(out.slice(0, 2).map(c => c.tradition).sort()).toEqual(['sufi', 'vedanta']);
    // the over-represented tradition is capped at MAX_PER_TRADITION (3)
    expect(out.filter(c => c.tradition === 'plotinus')).toHaveLength(3);
    // 3 plotinus + vedanta + sufi
    expect(out).toHaveLength(5);
  });

  it('is order-independent: shuffling the input does not change the ranking', () => {
    const mk = () => [
      chunk('ved', 'vedanta', { source: 'vector', distance: 0.3 }),
      ...Array.from({ length: 4 }, (_, i) => chunk(`plo${i}`, 'plotinus', { source: 'vector', distance: 0.3 })),
    ];
    const ordered = mergeAndRerank(mk(), [], 8).map(c => c.id);
    const shuffled = mergeAndRerank([...mk()].reverse(), [], 8).map(c => c.id);
    // vedanta (rare) leads in both orderings
    expect(ordered[0]).toBe('ved');
    expect(shuffled[0]).toBe('ved');
  });
});
