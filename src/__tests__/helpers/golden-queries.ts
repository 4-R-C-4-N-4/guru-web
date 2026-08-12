/**
 * src/__tests__/helpers/golden-queries.ts
 *
 * Loader + validator for the per-work golden query files under
 * fixtures/golden-queries/<work>.json (todo:f8610bc9, parent todo:a8559033).
 *
 * Two query kinds, kept separate on purpose (docs/golden-queries.md):
 *   - recall-probe: written from a chunk's content in a reader's own words,
 *     distinctive vocabulary deliberately paraphrased. Asserts only
 *     tradition/work survival into top-K — never chunk-level relevance.
 *   - relevance: a conceptual question the work answers that other traditions
 *     also answer. NO asserted target; graded post-hoc under the
 *     (query, chunk) judgment frame. The aggregation test exports these as a
 *     grading manifest.
 *
 * Every query records provenance chunk ids (the chunks it was drafted from)
 * for audit. Provenance is never asserted — asserting it would make the
 * paraphrase rule unenforceable in spirit.
 *
 * frozenEval partitions works between the frozen eval subset and the
 * fine-tune query distribution. The partition is BY WORK and one-way:
 * once a work's queries have been used to train, it never becomes eval.
 *
 * Validation is strict: unknown keys are errors, so a typo'd assertion key
 * fails loudly instead of silently never asserting.
 */

import { readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';

export const GOLDEN_QUERIES_DIR = join(__dirname, '..', 'fixtures', 'golden-queries');

export interface RecallProbe {
  kind: 'recall-probe';
  query: string;
  provenanceChunkIds: string[];
  /** Traditions that must survive into top-K. Defaults are deliberate: none. */
  mustIncludeTraditions?: string[];
  /** The work itself must survive into top-K (checked via works.member_text_ids). */
  mustIncludeWork?: boolean;
  note?: string;
}

export interface RelevanceQuery {
  kind: 'relevance';
  query: string;
  provenanceChunkIds: string[];
  note?: string;
}

export type GoldenQuery = RecallProbe | RelevanceQuery;

export interface GoldenQueriesFile {
  work: string;
  tradition: string;
  /** Corpus version the queries were last drafted/audited against. Informational
   *  provenance — downstream consumers warn on mismatch, never fail. */
  corpus_version: string;
  /** Work-level train/eval partition flag. Required — an explicit choice, no default. */
  frozenEval: boolean;
  note?: string;
  queries: GoldenQuery[];
}

const FILE_KEYS = new Set(['work', 'tradition', 'corpus_version', 'frozenEval', 'note', 'queries']);
const RECALL_KEYS = new Set(['kind', 'query', 'provenanceChunkIds', 'mustIncludeTraditions', 'mustIncludeWork', 'note']);
const RELEVANCE_KEYS = new Set(['kind', 'query', 'provenanceChunkIds', 'note']);
// Keys that would assert a target. Checked against relevance queries explicitly
// (beyond the unknown-key rule) so the error message states the actual rule.
const ASSERTION_KEYS = ['mustIncludeTraditions', 'mustIncludeWork', 'minTraditions', 'minConcepts', 'mustIncludeChunks'];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate one parsed golden-queries file. Returns a list of human-readable
 * errors; empty list means valid. `filename` is the basename the file was
 * loaded from — it must be `<work>.json`.
 */
export function validateGoldenQueriesFile(raw: unknown, filename: string): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(`${filename}: ${msg}`);

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    err('file must be a JSON object');
    return errors;
  }
  const file = raw as Record<string, unknown>;

  for (const key of Object.keys(file)) {
    if (!FILE_KEYS.has(key)) err(`unknown top-level key "${key}"`);
  }
  if (!isNonEmptyString(file.work)) err('"work" must be a non-empty string');
  if (!isNonEmptyString(file.tradition)) err('"tradition" must be a non-empty string');
  if (!isNonEmptyString(file.corpus_version)) err('"corpus_version" must be a non-empty string');
  if (typeof file.frozenEval !== 'boolean') err('"frozenEval" must be a boolean (explicit train/eval choice, no default)');
  if (file.note !== undefined && !isNonEmptyString(file.note)) err('"note" must be a non-empty string when present');

  if (isNonEmptyString(file.work) && filename !== `${file.work}.json`) {
    err(`filename must be "<work>.json" — work is "${file.work}"`);
  }

  if (!Array.isArray(file.queries) || file.queries.length === 0) {
    err('"queries" must be a non-empty array');
    return errors;
  }

  file.queries.forEach((q: unknown, i: number) => {
    const at = (msg: string) => err(`queries[${i}]: ${msg}`);
    if (typeof q !== 'object' || q === null || Array.isArray(q)) {
      at('must be an object');
      return;
    }
    const query = q as Record<string, unknown>;

    if (query.kind !== 'recall-probe' && query.kind !== 'relevance') {
      at('"kind" must be "recall-probe" or "relevance"');
      return;
    }
    const allowed = query.kind === 'recall-probe' ? RECALL_KEYS : RELEVANCE_KEYS;
    for (const key of Object.keys(query)) {
      if (!allowed.has(key)) at(`unknown key "${key}" for kind "${query.kind}"`);
    }

    if (!isNonEmptyString(query.query)) at('"query" must be a non-empty string');
    if (query.note !== undefined && !isNonEmptyString(query.note)) at('"note" must be a non-empty string when present');

    const prov = query.provenanceChunkIds;
    if (!Array.isArray(prov) || prov.length === 0 || !prov.every(isNonEmptyString)) {
      at('"provenanceChunkIds" must be a non-empty array of chunk ids (recorded for audit, never asserted)');
    }

    if (query.kind === 'recall-probe') {
      const traditions = query.mustIncludeTraditions;
      if (traditions !== undefined && (!Array.isArray(traditions) || traditions.length === 0 || !traditions.every(isNonEmptyString))) {
        at('"mustIncludeTraditions" must be a non-empty array of tradition ids when present');
      }
      if (query.mustIncludeWork !== undefined && typeof query.mustIncludeWork !== 'boolean') {
        at('"mustIncludeWork" must be a boolean when present');
      }
      const hasAssertion =
        (Array.isArray(traditions) && traditions.length > 0) || query.mustIncludeWork === true;
      if (!hasAssertion) {
        at('recall-probe needs at least one assertion: "mustIncludeTraditions" and/or "mustIncludeWork": true');
      }
    } else {
      for (const key of ASSERTION_KEYS) {
        if (key in query) {
          at(`relevance queries assert nothing — remove "${key}" (they are graded post-hoc from the manifest)`);
        }
      }
    }
  });

  return errors;
}

/** Basenames of real per-work files in a golden-queries dir. `_`-prefixed
 *  files (e.g. _example.json) are documentation, not corpus truth — skipped. */
export function listGoldenQueryFiles(dir: string = GOLDEN_QUERIES_DIR): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .sort();
}

/** Load + validate every real per-work file. Throws with all collected errors
 *  if any file is invalid, so a broken fixture can never feed the gate. */
export function loadGoldenQueryFiles(dir: string = GOLDEN_QUERIES_DIR): GoldenQueriesFile[] {
  const errors: string[] = [];
  const files: GoldenQueriesFile[] = [];
  for (const name of listGoldenQueryFiles(dir)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (e) {
      errors.push(`${basename(name)}: invalid JSON — ${(e as Error).message}`);
      continue;
    }
    const fileErrors = validateGoldenQueriesFile(raw, name);
    if (fileErrors.length > 0) errors.push(...fileErrors);
    else files.push(raw as GoldenQueriesFile);
  }
  if (errors.length > 0) {
    throw new Error(`golden-queries fixtures invalid:\n  ${errors.join('\n  ')}`);
  }
  return files;
}
