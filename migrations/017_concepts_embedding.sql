-- 017_concepts_embedding.sql
-- Semantic query→concept matching (ticket d6472704).
--
-- The graph retrieval leg matches a query to concepts by keyword LIKE against
-- concept/family/alias labels (src/lib/graph.ts:extractConcepts) — brittle: a
-- paraphrased query that shares no literal words with a concept's label never
-- reaches the concept graph, so the whole leg silently drops out.
--
-- This adds a concept embedding (same nomic-embed-text VECTOR(768) as chunks and
-- the query) so the query can be matched to concepts SEMANTICALLY via pgvector,
-- reusing the query embedding already computed for the vector leg. Populated by
-- scripts/embed-concepts.ts. Nullable: absent until embedded, and the semantic
-- leg skips concepts whose embedding IS NULL.
--
-- No ANN index: there are ~150 concepts, so a sequential cosine scan is already
-- sub-millisecond; an ivfflat/hnsw index would cost maintenance for no gain.

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS embedding VECTOR(768);
