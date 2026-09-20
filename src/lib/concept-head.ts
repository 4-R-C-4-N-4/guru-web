/**
 * src/lib/concept-head.ts
 *
 * Trained query→concept head (ticket d6472704, rung 2). A one-vs-rest logistic
 * layer over the frozen nomic query embedding — inference is a single matmul,
 * CPU-inline, no model server. Beats the raw-cosine semantic leg roughly 2× on
 * held-out query→concept recall/precision (short/abstract queries where cosine
 * collapses). Trained offline by scripts/train_concept_head.py → concept-head.json.
 */
import headArtifact from '../data/concept-head.json';
import type { ConceptMatch, MatchTier } from './types';

interface HeadArtifact {
  dim: number;
  normalize: boolean;
  concepts: string[];
  w: number[][]; // [nConcepts][dim]
  b: number[];   // [nConcepts]
}

const H = headArtifact as HeadArtifact;

/**
 * Score the query embedding against every trained concept head and return the
 * concepts whose probability clears `threshold`, capped at the top `k`. Matches
 * are tier 'concept' — direct concept hits, learned. Returns [] if the artifact
 * dimension doesn't match the embedding (fail safe — the caller keeps the keyword
 * leg).
 */
export function classifyConcepts(
  queryEmbedding: number[],
  k: number,
  threshold: number
): ConceptMatch[] {
  if (!H.concepts?.length || queryEmbedding.length !== H.dim) return [];

  let q = queryEmbedding;
  if (H.normalize) {
    let ss = 0;
    for (let i = 0; i < q.length; i++) ss += q[i] * q[i];
    const norm = Math.sqrt(ss) || 1;
    q = q.map(x => x / norm);
  }

  const scored: { conceptId: string; prob: number }[] = [];
  for (let j = 0; j < H.concepts.length; j++) {
    const wj = H.w[j];
    let logit = H.b[j];
    for (let i = 0; i < wj.length; i++) logit += wj[i] * q[i];
    const prob = 1 / (1 + Math.exp(-logit));
    if (prob >= threshold) scored.push({ conceptId: H.concepts[j], prob });
  }
  scored.sort((a, b) => b.prob - a.prob);
  return scored.slice(0, k).map(s => ({ conceptId: s.conceptId, matchTier: 'concept' as MatchTier }));
}
