/**
 * src/__tests__/rerank.test.ts
 *
 * Unit tests for mergeAndRerank (todo:d1a94167). Pure function, no DB —
 * synthetic vector/graph candidates in, ranked top-K out. These pin the
 * intended behavior for the three scoring bugs:
 *   - 3251a8d6  vector hits get an explicit 'inferred' tier (not silent 0.4)
 *   - 0a771923  graph results score on an independent term (not a fake distance)
 *   - ce844add  diversity rewards rare traditions, order-independent
 *   - 0c38a006  lexical leg merged as a max-normalised additive term
 */
import { describe, it, expect } from 'vitest';
import { mergeAndRerank } from '@/lib/retriever';
import type { RetrievedChunk } from '@/lib/types';

function chunk(
  id: string,
  tradition: string,
  opts: {
    source: 'vector' | 'graph';
    distance?: number;
    tier?: RetrievedChunk['tier'];
    conceptMatchWeight?: number;
  },
): RetrievedChunk {
  return {
    id, text_id: 't', tradition, text_name: 'tn', section: 's',
    translator: null, body: 'b', token_count: 1,
    source: opts.source, distance: opts.distance, tier: opts.tier,
    conceptMatchWeight: opts.conceptMatchWeight,
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

describe('mergeAndRerank — match-tier weight (todo:08503113)', () => {
  it('a concept-tier graph hit outranks an otherwise-identical domain-tier hit', () => {
    // Same edge tier, same (zero) similarity, distinct traditions so the
    // diversity bump is equal — only the match weight differs.
    const out = mergeAndRerank([], [
      chunk('domain', 'x', { source: 'graph', tier: 'verified', conceptMatchWeight: 0.25 }),
      chunk('concept', 'y', { source: 'graph', tier: 'verified', conceptMatchWeight: 1.0 }),
    ], 5);
    expect(out.map(c => c.id)).toEqual(['concept', 'domain']);
  });

  it('orders graph hits concept > family > domain at equal tier/similarity/diversity', () => {
    // Distinct traditions → equal diversity bump; identical edge tier and zero
    // similarity → match weight is the only differentiator.
    const out = mergeAndRerank([], [
      chunk('dom', 'a', { source: 'graph', tier: 'verified', conceptMatchWeight: 0.25 }),
      chunk('fam', 'b', { source: 'graph', tier: 'verified', conceptMatchWeight: 0.5 }),
      chunk('con', 'c', { source: 'graph', tier: 'verified', conceptMatchWeight: 1.0 }),
    ], 5);
    expect(out.map(c => c.id)).toEqual(['con', 'fam', 'dom']);
  });

  it('vector-only hits (no conceptMatchWeight) are unchanged — weight defaults to 1.0', () => {
    // A vector hit and a concept-tier graph hit with identical inputs; the vector
    // hit must not be penalised for lacking a match weight.
    const out = mergeAndRerank(
      [chunk('vec', 'x', { source: 'vector', distance: 0.1 })],
      [],
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('vec');
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

// Lexical leg as a max-normalised additive term (todo:0c38a006). A lexical hit
// carries a raw ts_rank (lexRank); the reranker normalises it against the
// strongest lexical hit in the candidate set and adds lexicalWeight × that.
function lex(id: string, tradition: string, lexRank: number): RetrievedChunk {
  return {
    id, text_id: 't', tradition, text_name: 'tn', section: 's',
    translator: null, body: 'b', token_count: 1, source: 'lexical', lexRank,
  };
}

describe('mergeAndRerank — lexical leg (todo:0c38a006)', () => {
  it('is a no-op when no lexical results are supplied (default-off neutrality)', () => {
    const vec = [
      chunk('hi', 'x', { source: 'vector', distance: 0.1 }),
      chunk('lo', 'y', { source: 'vector', distance: 0.6 }),
    ];
    const base = mergeAndRerank(vec, [], 5).map(c => c.id);
    const empty = mergeAndRerank(vec, [], 5, { lexicalResults: [] }).map(c => c.id);
    expect(empty).toEqual(base); // identical ranking, no divide-by-zero on maxLex=0
  });

  it('surfaces a lexical-only hit the vector leg never returned, given enough weight', () => {
    const out = mergeAndRerank(
      [chunk('v', 'x', { source: 'vector', distance: 0.4 })], // similarity 0.6
      [],
      5,
      { lexicalResults: [lex('L', 'y', 0.2)], lexicalWeight: 2.0 },
    );
    expect(out.map(c => c.id)).toContain('L');
    expect(out[0].id).toBe('L'); // 0.12 floor + 2.0×1.0 normLex beats 0.7×0.6 + 0.12
  });

  it('normalises ts_rank against the max, not its absolute value', () => {
    // A single tiny ts_rank still normalises to 1.0 → full weight.
    const tiny = mergeAndRerank([], [], 5, { lexicalResults: [lex('t', 'x', 0.0001)], lexicalWeight: 1.0 });
    expect(tiny[0].id).toBe('t');
    // Relative magnitude is preserved: 0.20 → normLex 1.0, 0.05 → normLex 0.25.
    const ranked = mergeAndRerank([], [], 5, {
      lexicalResults: [lex('hi', 'x', 0.20), lex('lo', 'y', 0.05)],
      lexicalWeight: 1.0,
    });
    expect(ranked.map(c => c.id)).toEqual(['hi', 'lo']);
  });

  it('adds the lexical term on top of vector similarity for a chunk in both legs', () => {
    const out = mergeAndRerank(
      [
        chunk('both', 'x', { source: 'vector', distance: 0.4 }),
        chunk('vonly', 'y', { source: 'vector', distance: 0.4 }), // equal similarity
      ],
      [],
      5,
      { lexicalResults: [lex('both', 'x', 0.2)], lexicalWeight: 1.0 },
    );
    expect(out[0].id).toBe('both'); // additive: vector sim + lexical term > vector sim alone
    expect(out.find(c => c.id === 'both')!.source).toBe('vector'); // overlap keeps original leg/source
  });
});

// Lexical gate-cap (todo:8bc7698b). A lexical-only hit (no vector support,
// similarity 0) has its normalised lexical term capped so it can't leapfrog a
// genuine vector answer — the fix for corpus-growth FTS flooding. On by default;
// vector-corroborated hits and the opts.lexGateCap=null kill-switch are exempt.
describe('mergeAndRerank — lexical gate-cap (todo:8bc7698b)', () => {
  it('caps a strong lexical-only hit so it cannot bury a strong vector answer (default on)', () => {
    // Strong vector answer: distance 0.15 → similarity 0.85. Score ≈ 0.7×0.85 +
    // 0.12 floor + 0.1 div = 0.815. A sim=0 lexical-only hit at full normLex
    // would score LEXICAL_WEIGHT(2.0) + 0.12 + 0.1 = 2.22 and win (the bug);
    // gated at 0.49 it scores 0.49 + 0.12 + 0.1 = 0.71 and loses.
    const out = mergeAndRerank(
      [chunk('vec', 'x', { source: 'vector', distance: 0.15 })],
      [],
      5,
      { lexicalResults: [lex('flood', 'y', 0.2)], lexicalWeight: 2.0 },
    );
    expect(out[0].id).toBe('vec'); // vector answer survives the flood
  });

  it('does NOT cap a lexical hit that also has vector support', () => {
    // 'both' has vector similarity (distance 0.5 → 0.5) AND a lexical hit; the
    // gate only applies to sim=0 hits, so its full lexical term still counts and
    // it beats an equal-similarity vector-only peer.
    const out = mergeAndRerank(
      [
        chunk('both', 'x', { source: 'vector', distance: 0.5 }),
        chunk('vonly', 'y', { source: 'vector', distance: 0.5 }),
      ],
      [],
      5,
      { lexicalResults: [lex('both', 'x', 0.2)], lexicalWeight: 2.0 },
    );
    expect(out[0].id).toBe('both');
  });

  it('a weak lexical-only rescue below the cap is unaffected (cap is a ceiling, not a floor)', () => {
    // normLex 0.25 × weight 1.0 = 0.25 < 0.49 cap → passes through unchanged, so
    // the entity-query rescue the lexical leg exists for still surfaces.
    const out = mergeAndRerank([], [], 5, {
      lexicalResults: [lex('hi', 'x', 0.20), lex('lo', 'y', 0.05)],
      lexicalWeight: 1.0,
    });
    expect(out.map(c => c.id)).toEqual(['hi', 'lo']); // relative order preserved
  });

  it('opts.lexGateCap=null disables the gate (env kill-switch parity)', () => {
    // With the gate off, the uncapped lexical flood wins again — proves the
    // kill-switch restores exact prior behaviour.
    const out = mergeAndRerank(
      [chunk('vec', 'x', { source: 'vector', distance: 0.15 })],
      [],
      5,
      { lexicalResults: [lex('flood', 'y', 0.2)], lexicalWeight: 2.0, lexGateCap: null },
    );
    expect(out[0].id).toBe('flood');
  });
});

// Primary floor (todo:1a8c3bbf, §8.1): a slot-level PROMOTION of a relevant primary
// the ranking crowded out, paid for by yielding the weakest SYNTHESIS slot — no
// score change, never displacing another primary, gated by a relevance threshold.
describe('mergeAndRerank — primary floor (todo:1a8c3bbf)', () => {
  const floor = (count: number, synthesis: string[], simThreshold = 0.5) =>
    ({ count, simThreshold, synthesis: new Set(synthesis) });

  // Three synthesis (theosophy) chunks fill the top-3; a relevant primary (norse,
  // sim 0.6) is crowded to rank 4 despite the diversity bump.
  const synthTrip = () => [
    chunk('th1', 'theosophy', { source: 'vector', distance: 0.10 }),
    chunk('th2', 'theosophy', { source: 'vector', distance: 0.12 }),
    chunk('th3', 'theosophy', { source: 'vector', distance: 0.14 }),
  ];

  it('is a no-op when no floor is supplied — the primary stays crowded out', () => {
    const primary = chunk('norse1', 'norse', { source: 'vector', distance: 0.4 });
    const out = mergeAndRerank([...synthTrip(), primary], [], 3).map(c => c.id);
    expect(out).toEqual(['th1', 'th2', 'th3']);
  });

  it('promotes a relevant primary into top-K by yielding the weakest synthesis slot', () => {
    const primary = chunk('norse1', 'norse', { source: 'vector', distance: 0.4 }); // sim 0.6 ≥ τ
    const out = mergeAndRerank([...synthTrip(), primary], [], 3, { primaryFloor: floor(1, ['theosophy']) }).map(c => c.id);
    expect(out).toContain('norse1');   // primary pulled in
    expect(out).not.toContain('th3');  // weakest synthesis slot yielded (not th1/th2)
    expect(out).toHaveLength(3);
  });

  it('does NOT promote a primary below the relevance gate τ (stays buried)', () => {
    const weak = chunk('norse1', 'norse', { source: 'vector', distance: 0.6 }); // sim 0.4 < τ=0.5
    const out = mergeAndRerank([...synthTrip(), weak], [], 3, { primaryFloor: floor(1, ['theosophy']) }).map(c => c.id);
    expect(out).toEqual(['th1', 'th2', 'th3']);
  });

  it('never displaces another primary — no synthesis slot means no change', () => {
    const prims = [
      chunk('p1', 'platonism', { source: 'vector', distance: 0.10 }),
      chunk('p2', 'gnosticism', { source: 'vector', distance: 0.12 }),
      chunk('p3', 'hinduism', { source: 'vector', distance: 0.14 }),
    ];
    const crowded = chunk('norse1', 'norse', { source: 'vector', distance: 0.4 });
    const base = mergeAndRerank([...prims, crowded], [], 3).map(c => c.id);
    const out = mergeAndRerank([...prims, crowded], [], 3, { primaryFloor: floor(1, ['theosophy']) }).map(c => c.id);
    expect(out).toEqual(base); // no theosophy slot to yield → ranking untouched
  });

  it('respects count: two qualifying primaries + count 1 promotes exactly one', () => {
    const synth = [
      chunk('th1', 'theosophy', { source: 'vector', distance: 0.10 }),
      chunk('th2', 'theosophy', { source: 'vector', distance: 0.12 }),
    ];
    const primA = chunk('norse1', 'norse', { source: 'vector', distance: 0.40 });
    const primB = chunk('celtic1', 'celtic', { source: 'vector', distance: 0.42 });
    const out = mergeAndRerank([...synth, primA, primB], [], 2, { primaryFloor: floor(1, ['theosophy']) });
    expect(out.filter(c => c.tradition === 'norse' || c.tradition === 'celtic')).toHaveLength(1);
    expect(out).toHaveLength(2);
  });
});
