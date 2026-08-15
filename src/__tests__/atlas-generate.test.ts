/**
 * src/__tests__/atlas-generate.test.ts
 *
 * generateAtlasEdition writes a draft atlas edition from the deterministic
 * snapshot + a model completion. Contract: it refuses to run against a corpus
 * with zero parallels, numbers editions, refuses to stack drafts, and stores
 * the snapshot + cited chunks on a seed_kind='atlas' row.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({ one: vi.fn(), query: vi.fn(), exec: vi.fn() }));
vi.mock('@/lib/atlas', () => ({ computeAtlasSnapshot: vi.fn() }));
vi.mock('@/lib/model', () => ({ completeStream: vi.fn() }));
vi.mock('@/lib/cost', () => ({ computeCost: vi.fn() }));

import { generateAtlasEdition, AtlasRefusal } from '@/lib/atlas-generate';
import { computeAtlasSnapshot } from '@/lib/atlas';
import { one } from '@/lib/db';
import { completeStream } from '@/lib/model';
import { computeCost } from '@/lib/cost';

const mSnap = computeAtlasSnapshot as MockedFunction<typeof computeAtlasSnapshot>;
const mOne = one as MockedFunction<typeof one>;
const mStream = completeStream as MockedFunction<typeof completeStream>;
const mCost = computeCost as MockedFunction<typeof computeCost>;

const ch = (id: string, tradition: string) => ({
  id, text_id: `${id}-text`, tradition, text_name: 'T', section: 'I.1', translator: null, tier: 'verified', body: 'passage', token_count: 4,
});

function snapshot(parallelsTotal = 50148) {
  return {
    generatedAt: '2026-06-06T00:00:00Z', schemaVersion: '3',
    headline: { traditions: 16, concepts: 95, families: 28, parallelsTotal, parallelsMedianWeight: -1.48, parallelsP90Weight: 0.52, contrasts: 8 },
    documentLayer: { works: 52, dossiers: 52, summaryNodesL1: 214, summaryNodesL2: 52 },
    traditionMatrix: [{ a: 'neoplatonism', b: 'taoism', parallels: 322, medianWeight: -0.87 }],
    centrality: [{ tradition: 'neoplatonism', chunks: 828, parallelDegree: 2500, partnerTraditions: 13, parallelsPer100Chunks: 301.9, meanParallelWeight: -0.9 }],
    bridgeConcepts: [{ label: 'Apophatic Theology', domain: 'theology', family: 'Divine Nature', traditions: 15, mentions: 646 }],
    familyBridges: [{ id: 'theology.divine_nature', label: 'Divine Nature', domain: 'theology', traditions: 15, concepts: 5, mentions: 2510 }],
    hierarchy: [{ domain: 'theology', families: [{ id: 'theology.divine_nature', label: 'Divine Nature', concepts: ['Apophatic Theology'] }] }],
    longRangeCases: [{ a: 'neoplatonism', b: 'taoism', parallels: 322, exemplars: [{ a: ch('a1', 'neoplatonism'), b: ch('b1', 'taoism') }] }],
    contrasts: [{ a: ch('c1', 'zoroastrianism'), b: ch('c2', 'neoplatonism'), annotation: 'They diverge on duality.' }],
    dossierCapsules: [],
  } as never;
}

async function* streamOf(text: string) {
  yield { choices: [{ delta: { content: text } }] } as never;
  yield { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 2000 } } as never;
}

const GOOD = `TITLE: The Shape of the Whole\nDEK: What the aggregate shows.\n\n${'A grounded essay body. '.repeat(20)}\n\nCITATIONS:\n[neoplatonism | Enneads | V.1 | TIER: verified]`;

beforeEach(() => {
  vi.clearAllMocks();
  mSnap.mockResolvedValue(snapshot());
  mCost.mockResolvedValue({ cost_usd: 0.05 } as never);
  mStream.mockReturnValue(streamOf(GOOD) as never);
  mOne.mockImplementation(async (sql: string) => {
    if (sql.includes('status = ANY')) return null as never;            // no in-flight draft
    if (sql.includes('MAX(edition_no)')) return { next: 1 } as never;  // next edition
    if (sql.includes('WHERE slug')) return null as never;              // uniqueSlug: free
    if (sql.includes('INSERT INTO blog_posts')) return { id: 'ed-1' } as never;
    return null as never;
  });
});

describe('generateAtlasEdition', () => {
  it('writes a seed_kind=atlas draft with edition_no, snapshot, and cited chunks', async () => {
    const res = await generateAtlasEdition({ generatedAt: '2026-06-06T00:00:00Z' });
    expect(res).toMatchObject({ id: 'ed-1', editionNo: 1, slug: 'state-of-the-atlas-no-1' });
    expect(res.title).toContain('State of the Atlas №1');

    const insert = mOne.mock.calls.find(c => (c[0] as string).includes('INSERT INTO blog_posts'))!;
    const sql = insert[0] as string;
    const params = insert[1] as unknown[];
    expect(sql).toMatch(/'draft', 'atlas'/);
    expect(params).toContain(1); // edition_no
    // chunks_used JSON carries the cited passages; atlas_snapshot carries the snapshot.
    const chunksUsed = JSON.parse(params.find(p => typeof p === 'string' && (p as string).includes('"a1"')) as string);
    expect(chunksUsed.map((c: { id: string }) => c.id).sort()).toEqual(['a1', 'b1', 'c1', 'c2']);
    expect(params.some(p => typeof p === 'string' && (p as string).includes('"schemaVersion":"3"'))).toBe(true);
  });

  it('refuses (AtlasRefusal) to stack a second edition while one is in flight', async () => {
    mOne.mockImplementation(async (sql: string) =>
      sql.includes('status = ANY') ? ({ id: 'draft-x', edition_no: 1 } as never) : (null as never),
    );
    await expect(generateAtlasEdition({ generatedAt: 'x' })).rejects.toThrow(AtlasRefusal);
    await expect(generateAtlasEdition({ generatedAt: 'x' })).rejects.toThrow(/already in flight/);
  });

  it('refuses (AtlasRefusal) when the corpus has no parallels', async () => {
    mSnap.mockResolvedValue(snapshot(0));
    await expect(generateAtlasEdition({ generatedAt: 'x' })).rejects.toThrow(AtlasRefusal);
  });
});
