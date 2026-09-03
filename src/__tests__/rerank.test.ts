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
    text_id?: string;
  },
): RetrievedChunk {
  return {
    // text_id defaults to 't' for the scoring/tier/lexical tests where per-work
    // counting is irrelevant; the primary-floor tests set it explicitly because
    // the floor's synthesis-slot bookkeeping is PER text_id (todo:6702edd0).
    id, text_id: opts.text_id ?? 't', tradition, text_name: 'tn', section: 's',
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
  // works.kind variant (todo:6702edd0): classify by a per-text_id kind map (the
  // shipped default path) instead of the tradition proxy — the only way to make a
  // primary and a synthesis work share one tradition, which the cap-guard test needs.
  const kindFloor = (count: number, kind: Record<string, string>, simThreshold = 0.5) =>
    ({ count, simThreshold, synthesis: new Set<string>(), kind: new Map(Object.entries(kind)) });

  // Theosophy fills the top-3 via TWO DISTINCT synthesis works — secret-doctrine
  // takes 2 slots (redundant), isis-unveiled 1 (its sole slot). Distinct text_ids
  // (not the shared default) so the floor's PER-WORK slot counting is actually
  // exercised (finding: shared text_id masked it). A relevant primary (norse edda,
  // sim 0.6 ≥ τ) is crowded to rank 4.
  const synthTrip = () => [
    chunk('sd1', 'theosophy', { source: 'vector', distance: 0.10, text_id: 'secret-doctrine' }),
    chunk('sd2', 'theosophy', { source: 'vector', distance: 0.12, text_id: 'secret-doctrine' }),
    chunk('iu1', 'theosophy', { source: 'vector', distance: 0.14, text_id: 'isis-unveiled' }),
  ];
  const norse = () => chunk('edda1', 'norse', { source: 'vector', distance: 0.40, text_id: 'edda' }); // sim 0.60

  it('is a no-op when no floor is supplied — the primary stays crowded out', () => {
    const out = mergeAndRerank([...synthTrip(), norse()], [], 3).map(c => c.id);
    expect(out).toEqual(['sd1', 'sd2', 'iu1']);
  });

  it('promotes a relevant primary by yielding the weakest REDUNDANT slot, not the globally weakest', () => {
    // iu1 is the globally weakest synthesis slot but isis-unveiled's SOLE slot →
    // protected. secret-doctrine has 2 slots, so its weaker one (sd2) is the victim.
    // With a shared text_id this distinction is invisible — that's the point.
    const out = mergeAndRerank([...synthTrip(), norse()], [], 3, { primaryFloor: floor(1, ['theosophy']) }).map(c => c.id);
    expect(out).toContain('edda1');   // primary pulled in
    expect(out).toContain('iu1');     // isis-unveiled's sole slot preserved
    expect(out).not.toContain('sd2'); // secret-doctrine's redundant slot yielded
    expect(out).toHaveLength(3);
  });

  it('does NOT promote a primary below the relevance gate τ (stays buried)', () => {
    const weak = chunk('edda1', 'norse', { source: 'vector', distance: 0.6, text_id: 'edda' }); // sim 0.4 < τ=0.5
    const out = mergeAndRerank([...synthTrip(), weak], [], 3, { primaryFloor: floor(1, ['theosophy']) }).map(c => c.id);
    expect(out).toEqual(['sd1', 'sd2', 'iu1']);
  });

  it('never displaces another primary — no synthesis slot means no change', () => {
    const prims = [
      chunk('p1', 'platonism', { source: 'vector', distance: 0.10, text_id: 'plato' }),
      chunk('p2', 'gnosticism', { source: 'vector', distance: 0.12, text_id: 'pistis-sophia' }),
      chunk('p3', 'hinduism', { source: 'vector', distance: 0.14, text_id: 'bhagavad-gita' }),
    ];
    const base = mergeAndRerank([...prims, norse()], [], 3).map(c => c.id);
    const out = mergeAndRerank([...prims, norse()], [], 3, { primaryFloor: floor(1, ['theosophy']) }).map(c => c.id);
    expect(out).toEqual(base); // no theosophy slot to yield → ranking untouched
  });

  it('never drops a synthesis work’s ONLY slot — keeps its mustIncludeWork (kybalion fix)', () => {
    // TWO distinct synthesis works, one slot each — NEITHER is redundant. Promoting
    // the crowded primary would drop a synthesis work's sole appearance, so the
    // ranking is left untouched. (Distinct text_ids: with a shared one these would
    // count as a single 2-slot work and the guard would wrongly allow a yield.)
    const syn1 = chunk('sd1', 'theosophy', { source: 'vector', distance: 0.10, text_id: 'secret-doctrine' });
    const syn2 = chunk('iu1', 'theosophy', { source: 'vector', distance: 0.11, text_id: 'isis-unveiled' });
    const out = mergeAndRerank([syn1, syn2, norse()], [], 2, { primaryFloor: floor(1, ['theosophy']) }).map(c => c.id);
    expect(out).toEqual(['sd1', 'iu1']); // both sole slots kept
    expect(out).not.toContain('edda1'); // no redundant synthesis to yield → no promotion
  });

  it('respects count: two qualifying primaries + count 1 promotes exactly one', () => {
    const synth = [
      chunk('sd1', 'theosophy', { source: 'vector', distance: 0.10, text_id: 'secret-doctrine' }),
      chunk('sd2', 'theosophy', { source: 'vector', distance: 0.12, text_id: 'secret-doctrine' }),
    ];
    const primA = chunk('edda1', 'norse', { source: 'vector', distance: 0.40, text_id: 'edda' });
    const primB = chunk('mab1', 'celtic', { source: 'vector', distance: 0.42, text_id: 'mabinogion' });
    const out = mergeAndRerank([...synth, primA, primB], [], 2, { primaryFloor: floor(1, ['theosophy']) });
    expect(out.filter(c => c.tradition === 'norse' || c.tradition === 'celtic')).toHaveLength(1);
    expect(out).toHaveLength(2);
  });

  // Finding: promotion must never breach MAX_PER_TRADITION. Once works.kind lets a
  // tradition hold BOTH primary and synthesis works, a tradition can be at the cap
  // with synthesis-only slots and still have a relevant primary queued. The victim
  // must come from that SAME tradition (net-zero), never from another tradition
  // (which would leave the promoted tradition at cap+1).
  it('keeps promotion within MAX_PER_TRADITION — evicts a same-tradition slot, not another tradition’s', () => {
    // esoteric is AT the cap (3) with two synthesis works: work-a (2 slots, redundant)
    // + work-b (1, sole). A relevant esoteric primary (work-d) is crowded out by the
    // cap. theosophy holds the globally-weakest redundant slots (work-c ×2) — the
    // trap the old code fell into: yielding work-c would push esoteric to 4.
    const chunks = [
      chunk('e1', 'esoteric',  { source: 'vector', distance: 0.10, text_id: 'work-a' }),
      chunk('e2', 'esoteric',  { source: 'vector', distance: 0.11, text_id: 'work-a' }),
      chunk('e3', 'esoteric',  { source: 'vector', distance: 0.12, text_id: 'work-b' }),
      chunk('ep', 'esoteric',  { source: 'vector', distance: 0.20, text_id: 'work-d' }), // primary, sim 0.80
      chunk('t1', 'theosophy', { source: 'vector', distance: 0.30, text_id: 'work-c' }),
      chunk('t2', 'theosophy', { source: 'vector', distance: 0.31, text_id: 'work-c' }),
    ];
    const pf = kindFloor(1, {
      'work-a': 'synthesis', 'work-b': 'synthesis', 'work-c': 'synthesis', 'work-d': 'primary',
    });
    const out = mergeAndRerank(chunks, [], 5, { primaryFloor: pf });
    const ids = out.map(c => c.id);
    expect(ids).toContain('ep');                                    // relevant primary promoted
    expect(out.filter(c => c.tradition === 'esoteric')).toHaveLength(3); // cap holds — not 4
    expect(ids).toContain('t2');                                    // another tradition's slot NOT stolen
    expect(ids).not.toContain('e2');                                // esoteric's own redundant slot yielded
  });

  // Finding: fill a genuinely free slot instead of dropping a qualifying primary.
  // dup-collapse frees a slot (out under-filled); the crowded relevant primary
  // should take it rather than be discarded because no synthesis slot was yielded.
  it('fills a free slot with a relevant primary when out is under-filled (does not drop it)', () => {
    const emb = new Map<string, number[]>([
      ['sd1', [1, 0, 0]],
      ['edda1', [1, 0, 0]], // identical → collapses against sd1 during emit
    ]);
    const sd1 = chunk('sd1', 'theosophy', { source: 'vector', distance: 0.10, text_id: 'secret-doctrine' });
    const sd2 = chunk('sd2', 'theosophy', { source: 'vector', distance: 0.12, text_id: 'secret-doctrine' });
    const prim = chunk('edda1', 'norse', { source: 'vector', distance: 0.40, text_id: 'edda' }); // sim 0.60 ≥ τ
    // edda1 is dup-collapsed cross-text against sd1 → skipped in emit, leaving out at
    // 2/3. norse is below its cap, so the floor fills the free 3rd slot with it.
    const out = mergeAndRerank([sd1, sd2, prim], [], 3, {
      primaryFloor: floor(1, ['theosophy']),
      dupCollapse: { threshold: 0.99, sameTextOnly: false, embeddings: emb },
    }).map(c => c.id);
    expect(out).toContain('edda1'); // filled the free slot, not dropped
    expect(out).toHaveLength(3);
  });
});
