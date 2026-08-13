/**
 * src/__tests__/golden-queries-schema.test.ts
 *
 * CI-safe schema gate for the per-work golden query files (todo:f8610bc9,
 * parent todo:a8559033). No DB, no Ollama — this validates shape only, so a
 * malformed fixture fails in CI instead of silently dropping out of the
 * integration gate. Retrieval behaviour is asserted by
 * golden-queries.test.ts (INTEGRATION_TEST-gated).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GOLDEN_QUERIES_DIR,
  listGoldenQueryFiles,
  loadGoldenQueryFiles,
  validateGoldenQueriesFile,
} from './helpers/golden-queries';

/** A minimal valid file, cloned per test case then broken one way at a time. */
function validFile(): Record<string, unknown> {
  return {
    work: 'some-work',
    tradition: 'some_tradition',
    corpus_version: '50',
    frozenEval: false,
    queries: [
      {
        kind: 'recall-probe',
        query: 'a paraphrased question about the work',
        provenanceChunkIds: ['some_tradition.some-work-01.001'],
        mustIncludeTraditions: ['some_tradition'],
      },
      {
        kind: 'relevance',
        query: 'a conceptual question many traditions answer',
        provenanceChunkIds: ['some_tradition.some-work-01.002'],
      },
    ],
  };
}

describe('golden-queries fixtures', () => {
  it('every real per-work file validates', () => {
    // Throws with the full error list if any file is malformed.
    expect(() => loadGoldenQueryFiles()).not.toThrow();
  });

  it('underscore-prefixed files are documentation, not fixtures', () => {
    expect(listGoldenQueryFiles()).not.toContain('_example.json');
  });

  it('_example.json itself conforms to the schema', () => {
    const raw = JSON.parse(readFileSync(join(GOLDEN_QUERIES_DIR, '_example.json'), 'utf8'));
    // The example's work id is "example-work"; validate under the name a real
    // file with that id would have.
    expect(validateGoldenQueriesFile(raw, 'example-work.json')).toEqual([]);
  });
});

describe('validateGoldenQueriesFile', () => {
  const NAME = 'some-work.json';

  it('accepts a valid file', () => {
    expect(validateGoldenQueriesFile(validFile(), NAME)).toEqual([]);
  });

  it('rejects a missing frozenEval flag — the partition choice has no default', () => {
    const f = validFile();
    delete f.frozenEval;
    expect(validateGoldenQueriesFile(f, NAME).join()).toMatch(/frozenEval/);
  });

  it('rejects a filename that does not match the work id', () => {
    expect(validateGoldenQueriesFile(validFile(), 'other-work.json').join()).toMatch(/filename/);
  });

  it('rejects a recall probe with no assertion', () => {
    const f = validFile();
    delete (f.queries as Record<string, unknown>[])[0].mustIncludeTraditions;
    expect(validateGoldenQueriesFile(f, NAME).join()).toMatch(/at least one assertion/);
  });

  it('rejects a relevance query carrying an assertion key', () => {
    const f = validFile();
    (f.queries as Record<string, unknown>[])[1].mustIncludeTraditions = ['some_tradition'];
    expect(validateGoldenQueriesFile(f, NAME).join()).toMatch(/relevance queries assert nothing/);
  });

  it('rejects missing or empty provenance on any query', () => {
    const f = validFile();
    (f.queries as Record<string, unknown>[])[0].provenanceChunkIds = [];
    expect(validateGoldenQueriesFile(f, NAME).join()).toMatch(/provenanceChunkIds/);
  });

  it('rejects unknown keys so typos fail loudly', () => {
    const f = validFile();
    (f.queries as Record<string, unknown>[])[0].mustIncludeTradition = ['some_tradition'];
    expect(validateGoldenQueriesFile(f, NAME).join()).toMatch(/unknown key "mustIncludeTradition"/);
  });

  it('rejects an unknown kind', () => {
    const f = validFile();
    (f.queries as Record<string, unknown>[])[0].kind = 'recall_probe';
    expect(validateGoldenQueriesFile(f, NAME).join()).toMatch(/"kind" must be/);
  });
});
