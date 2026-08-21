/**
 * src/__tests__/blog-generate.test.ts
 *
 * Unit tests for the blog generator core (IMPL T3). The heavy collaborators
 * — db, retrieve, completeStream, computeCost — are mocked; the focus is the
 * seam contract: grounding guard before generation, status transitions,
 * structured chunks_used, slug collision, head-parse fallbacks, and that a
 * non-queued seed is a no-op.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  one: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('@/lib/retriever', () => ({
  retrieve: vi.fn(),
}));

vi.mock('@/lib/model', () => ({
  completeStream: vi.fn(),
  MAX_OUTPUT_TOKENS: 8192,
}));

vi.mock('@/lib/cost', () => ({
  computeCost: vi.fn(),
}));

import { generateDraft } from '@/lib/blog-generate';
import { query, one, exec } from '@/lib/db';
import { retrieve } from '@/lib/retriever';
import { completeStream } from '@/lib/model';
import { computeCost } from '@/lib/cost';

const mQuery = vi.mocked(query);
const mOne = vi.mocked(one);
const mExec = vi.mocked(exec);
const mRetrieve = vi.mocked(retrieve);
const mComplete = vi.mocked(completeStream);
const mCost = vi.mocked(computeCost);

const SEED = {
  id: 'seed-1',
  status: 'queued',
  concept_ids: ['c-emanation', 'c-tao'],
  angle: null,
  model: 'deepseek',
  scope_mode: 'all',
  blocked_traditions: null,
  blocked_texts: null,
  whitelisted_traditions: null,
  whitelisted_texts: null,
};

const CONCEPTS = [
  { id: 'c-emanation', label: 'emanation', definition: 'flowing forth of the One' },
  { id: 'c-tao', label: 'the Tao', definition: 'the way' },
];

const makeChunk = (id: string, tradition = 'neoplatonism') => ({
  id,
  text_id: `t-${id}`,
  tradition,
  text_name: `${tradition} Text`,
  section: 'S1',
  translator: null,
  body: 'The One overflows into being.',
  token_count: 8,
  source: 'vector' as const,
});

const makeStream = (chunks: unknown[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const c of chunks) yield c;
  },
});

// A realistic essay body — long enough to clear the MIN_BODY_CHARS generation
// floor (a real grounded essay is thousands of chars; the floor only rejects
// empty/near-empty completions).
const ESSAY_BODY =
  'The essay body develops the parallel at length. It opens by naming the ' +
  'cross-tradition tension, then traces how each source passage bears on the ' +
  'resonance, holding genuine divergence open rather than flattening it into a ' +
  'false equivalence, and closes on a thought that lands rather than a teaser ' +
  'for the next instalment.';

// A completion stream that yields a well-formed essay plus a usage chunk.
const goodStream = (body = `TITLE: Two Names for One Source\nDEK: A resonance.\n\n${ESSAY_BODY}\n\nCITATIONS:\n[NEOPLATONISM | Enneads | V.1 | TIER: verified]`) =>
  makeStream([
    { choices: [{ delta: { content: body } }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 200 } },
  ]);

/**
 * Wire the db `one` mock: seed lookup returns `seed`; slug-existence checks
 * return whatever `slugRows` yields per call (default: always free).
 */
function wireOne(seed: unknown, slugRows: Array<unknown> = []) {
  let slugCall = 0;
  mOne.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM blog_posts WHERE id')) return seed as never;
    if (sql.includes('WHERE slug')) return (slugRows[slugCall++] ?? null) as never;
    return null as never;
  });
}

// Find the final blog_posts UPDATE exec call and its params.
function lastUpdate(): { sql: string; params: unknown[] } | null {
  const calls = mExec.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const [sql, params] = calls[i] as [string, unknown[]];
    if (sql.includes('UPDATE blog_posts')) return { sql, params };
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mQuery.mockResolvedValue(CONCEPTS as never);
  mCost.mockResolvedValue({ cost_usd: 0.0123, pricing: {} as never });
});

describe('generateDraft — grounding guard (HARD RULE 2)', () => {
  it('parks thin retrieval in needs_attention WITHOUT calling the model', async () => {
    wireOne(SEED);
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b')]); // < MIN_CHUNKS (4)

    await generateDraft('seed-1');

    expect(mComplete).not.toHaveBeenCalled();
    const upd = lastUpdate();
    expect(upd?.sql).toContain("status='needs_attention'");
    expect(upd?.params?.[1]).toMatch(/thin retrieval: 2 chunks/);
  });
});

describe('generateDraft — happy path', () => {
  beforeEach(() => {
    wireOne(SEED);
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b'), makeChunk('c'), makeChunk('d')]);
    mComplete.mockResolvedValue(goodStream() as never);
  });

  it('produces a draft with parsed title, stripped citations, structured chunks_used', async () => {
    await generateDraft('seed-1');

    const upd = lastUpdate()!;
    expect(upd.sql).toContain("status='draft'");
    const [, title, slug, dek, content, chunksJson, cost] = upd.params;
    expect(title).toBe('Two Names for One Source');
    expect(slug).toBe('two-names-for-one-source');
    expect(dek).toBe('A resonance.');            // model-authored DEK is persisted, not discarded
    expect(content).toContain('develops the parallel');
    expect(content).not.toContain('CITATIONS:'); // tail stripped
    expect(content).not.toContain('TITLE:');      // head stripped
    expect(content).not.toContain('DEK:');        // head stripped
    const used = JSON.parse(chunksJson as string);
    expect(used).toHaveLength(4);
    expect(used[0]).toEqual({ id: 'a', tradition: 'neoplatonism', text_name: 'neoplatonism Text', section: 'S1' });
    expect(cost).toBe(0.0123);
  });

  it('sets status=generating before producing the draft', async () => {
    await generateDraft('seed-1');
    const sqls = mExec.mock.calls.map(c => c[0] as string);
    expect(sqls.some(s => s.includes("status='generating'"))).toBe(true);
  });
});

describe('generateDraft — free-text topic mode (todo:bf1c07fb)', () => {
  it('generates a draft from a topic seed without loading concepts', async () => {
    // A topic seed has no concept_ids; the generator must NOT query concepts,
    // must retrieve on the topic text, and must still produce a draft.
    wireOne({ ...SEED, topic: 'the role of silence in mystical union', concept_ids: null });
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b'), makeChunk('c'), makeChunk('d')]);
    mComplete.mockResolvedValue(goodStream() as never);

    await generateDraft('seed-1');

    // concept lookup must not happen in topic mode
    expect(mQuery).not.toHaveBeenCalled();
    // retrieval is driven by the topic text
    expect(mRetrieve).toHaveBeenCalledWith('the role of silence in mystical union', expect.anything());
    const upd = lastUpdate()!;
    expect(upd.sql).toContain("status='draft'");
  });

  it('falls back to the topic as the title when the model omits TITLE', async () => {
    wireOne({ ...SEED, topic: 'apophatic silence and the word', concept_ids: null });
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b'), makeChunk('c'), makeChunk('d')]);
    mComplete.mockResolvedValue(goodStream(`No structured head here. ${ESSAY_BODY}`) as never);

    await generateDraft('seed-1');

    const upd = lastUpdate()!;
    expect(upd.sql).toContain("status='draft'");
    expect(upd.params[1]).toBe('apophatic silence and the word'); // topic as fallback title
  });
});

describe('generateDraft — slug collision', () => {
  it('suffixes the slug when the base is taken', async () => {
    wireOne(SEED, [{ id: 'other' }]); // first slug check: taken; second: free
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b'), makeChunk('c'), makeChunk('d')]);
    mComplete.mockResolvedValue(goodStream() as never);

    await generateDraft('seed-1');

    const slug = lastUpdate()!.params[2];
    expect(slug).toBe('two-names-for-one-source-2');
  });
});

describe('generateDraft — head-parse fallback', () => {
  it('falls back to concept labels when TITLE/DEK are missing, still a draft', async () => {
    wireOne(SEED);
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b'), makeChunk('c'), makeChunk('d')]);
    mComplete.mockResolvedValue(goodStream(`Just a body with no structured head at all. ${ESSAY_BODY}`) as never);

    await generateDraft('seed-1');

    const upd = lastUpdate()!;
    expect(upd.sql).toContain("status='draft'");
    expect(upd.params[1]).toBe('emanation & the Tao'); // fallback title
  });
});

describe('generateDraft — empty generation guard', () => {
  it('parks an empty completion in needs_attention, not a draft (todo:831509e2)', async () => {
    // A reasoning model can return finish=stop with NO content body. Unlike the
    // thin-retrieval guard, completeStream IS called here — the failure is at
    // generation, not retrieval. The row must not become a publishable draft.
    wireOne(SEED);
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b'), makeChunk('c'), makeChunk('d')]);
    mComplete.mockResolvedValue(goodStream('   ') as never); // blank body, only whitespace

    await generateDraft('seed-1');

    expect(mComplete).toHaveBeenCalled(); // generation was attempted
    const upd = lastUpdate()!;
    expect(upd.sql).toContain("status='needs_attention'");
    expect(upd.params[1]).toMatch(/empty generation/);
    // never a draft
    const sawDraft = mExec.mock.calls.some(c => (c[0] as string).includes("status='draft'"));
    expect(sawDraft).toBe(false);
  });
});

describe('generateDraft — cost failure is non-fatal (HARD RULE 3)', () => {
  it('persists the draft with cost_usd null when computeCost throws', async () => {
    wireOne(SEED);
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b'), makeChunk('c'), makeChunk('d')]);
    mComplete.mockResolvedValue(goodStream() as never);
    mCost.mockRejectedValue(new Error('no pricing row'));

    await generateDraft('seed-1');

    const upd = lastUpdate()!;
    expect(upd.sql).toContain("status='draft'");
    expect(upd.params[6]).toBeNull(); // cost_usd (shifted by the new dek param)
  });
});

describe('generateDraft — double-fire guard', () => {
  it('is a no-op when the seed is not queued', async () => {
    wireOne({ ...SEED, status: 'draft' });

    await generateDraft('seed-1');

    expect(mRetrieve).not.toHaveBeenCalled();
    expect(mComplete).not.toHaveBeenCalled();
    expect(mExec).not.toHaveBeenCalled(); // never even flips to generating
  });

  it('is a no-op when the seed does not exist', async () => {
    wireOne(null);
    await generateDraft('missing');
    expect(mExec).not.toHaveBeenCalled();
  });
});

describe('generateDraft — thrown error parks in needs_attention', () => {
  it('lands needs_attention (never a partial draft) when generation throws', async () => {
    wireOne(SEED);
    mRetrieve.mockResolvedValue([makeChunk('a'), makeChunk('b'), makeChunk('c'), makeChunk('d')]);
    mComplete.mockRejectedValue(new Error('upstream 503'));

    await generateDraft('seed-1');

    const upd = lastUpdate()!;
    expect(upd.sql).toContain("status='needs_attention'");
    expect(upd.params[1]).toMatch(/upstream 503/);
  });
});
