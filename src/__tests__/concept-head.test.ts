/**
 * src/__tests__/concept-head.test.ts
 *
 * Mechanics of the trained query→concept head (d6472704). Uses the real
 * concept-head.json artifact but synthetic embeddings — asserts the scoring/gating
 * contract, not model quality (that's the holdout metric in the trainer).
 */
import { describe, it, expect } from 'vitest';
import { classifyConcepts } from '@/lib/concept-head';
import head from '@/data/concept-head.json';

const DIM = (head as { dim: number }).dim;
const CONCEPTS = new Set((head as { concepts: string[] }).concepts);

describe('classifyConcepts', () => {
  it('returns [] on embedding/artifact dimension mismatch (fail safe)', () => {
    expect(classifyConcepts([0, 1, 2], 8, 0.5)).toEqual([]);
  });

  it('caps at k, tags tier concept, and only emits known concepts', () => {
    const q = Array.from({ length: DIM }, (_, i) => Math.sin(i)); // arbitrary in-dim vector
    const out = classifyConcepts(q, 5, 0.0); // threshold 0 → gate off, just top-k
    expect(out.length).toBeLessThanOrEqual(5);
    for (const m of out) {
      expect(m.matchTier).toBe('concept');
      expect(CONCEPTS.has(m.conceptId)).toBe(true);
    }
  });

  it('threshold gates: prob >= 1 is unreachable for sigmoid → empty', () => {
    const q = Array.from({ length: DIM }, () => 0.01);
    expect(classifyConcepts(q, 8, 1.0)).toEqual([]);
  });

  it('a higher threshold never returns more matches than a lower one', () => {
    const q = Array.from({ length: DIM }, (_, i) => Math.cos(i));
    const loose = classifyConcepts(q, 50, 0.3).length;
    const tight = classifyConcepts(q, 50, 0.7).length;
    expect(tight).toBeLessThanOrEqual(loose);
  });
});
