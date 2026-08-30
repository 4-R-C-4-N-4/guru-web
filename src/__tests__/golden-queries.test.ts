/**
 * src/__tests__/golden-queries.test.ts
 *
 * Aggregation gate for the per-work golden query files (todo:df76ff48,
 * parent todo:a8559033). This is the SOURCE OF TRUTH for retrieval regression
 * (todo:697f9e58): one fixture per corpus.works id, grown work by work as the
 * corpus ritual ships fixtures/golden-queries/<work>.json files
 * (docs/golden-queries.md). The older golden-retrieval.test.ts is deprecated
 * legacy — frozen at corpus v37, kept for reference, not extended.
 *
 * Two behaviours, matching the two query kinds:
 *   - recall probes are ASSERTED like the existing tradition-anchored
 *     goldens: the expected tradition (and optionally the work itself) must
 *     survive into top-K. Never chunk-level — provenance ids are audit trail.
 *   - relevance queries are NEVER asserted. They run through retrieval and
 *     are exported to a grading manifest (src/__tests__/output/
 *     relevance-manifest.json, gitignored) for post-hoc (query, chunk)
 *     judgment outside this repo.
 *
 * A file's corpus_version lagging the live corpus is a warning, not a
 * failure — the ritual updates each work's file with the corpus change that
 * touches it, and an unrelated corpus bump must not redden every work.
 *
 * Needs a live corpus + Ollama (the real retrieval path), so it's gated on
 * INTEGRATION_TEST and skipped in CI. Schema shape is enforced CI-side by
 * golden-queries-schema.test.ts.
 *
 * Run:
 *   export $(grep -E '^(DATABASE_URL|OLLAMA_URL)=' .env | xargs) \
 *   INTEGRATION_TEST=1 npx vitest run src/__tests__/golden-queries.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadGoldenQueryFiles, type GoldenQueriesFile, type RecallProbe, type RelevanceQuery } from './helpers/golden-queries';
import type { RetrievedChunk, UserPreferences } from '@/lib/types';

const SKIP = !process.env.INTEGRATION_TEST;

const TOP_K = 15; // same bar as golden-retrieval.test.ts
const MANIFEST_DIR = join(__dirname, 'output');
const MANIFEST_PATH = join(MANIFEST_DIR, 'relevance-manifest.json');

const files: GoldenQueriesFile[] = SKIP ? [] : loadGoldenQueryFiles();

const probes = files.flatMap(f =>
  f.queries.filter((q): q is RecallProbe => q.kind === 'recall-probe').map(q => ({ file: f, q })));
const relevance = files.flatMap(f =>
  f.queries.filter((q): q is RelevanceQuery => q.kind === 'relevance').map(q => ({ file: f, q })));

interface ManifestEntry {
  work: string;
  tradition: string;
  frozenEval: boolean;
  query: string;
  provenanceChunkIds: string[];
  note?: string;
  results: { rank: number; chunkId: string; textId: string; tradition: string; tier?: string }[];
}

describe.skipIf(SKIP)('Golden queries gate (per-work files)', () => {
  let retrieve: typeof import('@/lib/retriever').retrieve;
  /** work id -> its member text ids, for mustIncludeWork checks. */
  const workMembers = new Map<string, Set<string>>();
  const manifest: ManifestEntry[] = [];

  const PREFS: UserPreferences = {
    scopeMode: 'all',
    blockedTraditions: [],
    blockedTexts: [],
    whitelistedTraditions: [],
    whitelistedTexts: [],
    preferredModel: null,
    preferredVoice: 'scholar',
  };

  beforeAll(async () => {
    retrieve = (await import('@/lib/retriever')).retrieve;
    const { query } = await import('@/lib/db');

    const workIds = [...new Set(files.map(f => f.work))];
    const rows = await query<{ id: string; member_text_ids: string[] }>(
      `SELECT id, member_text_ids FROM works WHERE id = ANY($1)`,
      [workIds],
    );
    for (const row of rows) workMembers.set(row.id, new Set(row.member_text_ids));
    for (const id of workIds) {
      if (!workMembers.has(id)) throw new Error(`golden-queries file for unknown work "${id}"`);
    }

    const live = await query<{ value: string }>(
      `SELECT value FROM corpus_metadata WHERE key = 'corpus_version'`,
    );
    const liveVersion = live[0]?.value;
    for (const f of files) {
      if (liveVersion !== undefined && f.corpus_version !== liveVersion) {
        console.warn(
          `[golden-queries] ${f.work}.json drafted against corpus v${f.corpus_version}, live is v${liveVersion} — re-audit with the next corpus update that touches this work`,
        );
      }
    }
  }, 30_000);

  describe('recall probes (asserted)', () => {
    it.each(probes)('[$file.work] $q.query', async ({ file, q }) => {
      const chunks = await retrieve(q.query, PREFS, TOP_K);
      const traditions = new Set(chunks.map(c => c.tradition));

      for (const t of q.mustIncludeTraditions ?? []) {
        expect(traditions, `"${q.query}" should recall ${t}; got [${[...traditions].join(', ')}]`).toContain(t);
      }
      if (q.mustIncludeWork) {
        const members = workMembers.get(file.work)!;
        const hit = chunks.some(c => members.has(c.text_id));
        expect(hit, `"${q.query}" should surface ${file.work} itself in top-${TOP_K}; got text_ids [${[...new Set(chunks.map(c => c.text_id))].join(', ')}]`).toBe(true);
      }
    }, 30_000);
  });

  describe('relevance queries (manifest only, no assertion)', () => {
    it.each(relevance)('[$file.work] $q.query', async ({ file, q }) => {
      const chunks: RetrievedChunk[] = await retrieve(q.query, PREFS, TOP_K);
      // Harness sanity only — an empty result means retrieval is broken, not
      // that the query is bad. Deliberately NOT a relevance judgment.
      expect(chunks.length, `"${q.query}" returned no chunks — retrieval path broken?`).toBeGreaterThan(0);

      manifest.push({
        work: file.work,
        tradition: file.tradition,
        frozenEval: file.frozenEval,
        query: q.query,
        provenanceChunkIds: q.provenanceChunkIds,
        ...(q.note !== undefined ? { note: q.note } : {}),
        results: chunks.map((c, i) => ({
          rank: i + 1,
          chunkId: c.id,
          textId: c.text_id,
          tradition: c.tradition,
          ...(c.tier !== undefined ? { tier: c.tier } : {}),
        })),
      });
    }, 30_000);
  });

  afterAll(async () => {
    if (manifest.length === 0) return;
    const { query } = await import('@/lib/db');
    const live = await query<{ value: string }>(
      `SELECT value FROM corpus_metadata WHERE key = 'corpus_version'`,
    );
    mkdirSync(MANIFEST_DIR, { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify(
        {
          note: 'Relevance queries run against live retrieval with NO asserted target. Grade post-hoc under the (query, chunk) judgment frame; provenance ids are audit trail, never ground truth.',
          corpus_version: live[0]?.value ?? 'unknown',
          captured_at: new Date().toISOString(),
          topK: TOP_K,
          entries: manifest,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`[golden-queries] wrote relevance manifest: ${MANIFEST_PATH} (${manifest.length} queries)`);
  });
});
