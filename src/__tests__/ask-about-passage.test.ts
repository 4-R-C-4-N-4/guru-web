/**
 * src/__tests__/ask-about-passage.test.ts
 *
 * The reader→chat loop-closer (todo:7b60b6fb; chunk pin todo:76219c57).
 * Three contracts: askAboutHref builds a /chat deep link pinned via the
 * WORK's pin text id, carrying the chunk id, with a generic prefilled
 * question; getChunkPage exposes that pin (the work's first member — a
 * chunk in Dhammapada ch. 5 must pin ch. 1); chat-view consumes ?study=,
 * ?q= and ?chunk= in its param-strip effect without auto-sending, and
 * spends the chunk pin on the first query the server accepts (a 429 or
 * network failure leaves it intact for the retry).
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { readFileSync } from 'node:fs';
import { askAboutHref } from '@/lib/read-path';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import { getChunkPage } from '@/lib/reader';
import { getChunkById } from '@/lib/retriever';
import { one } from '@/lib/db';

const mOne = one as MockedFunction<typeof one>;

beforeEach(() => vi.clearAllMocks());

describe('askAboutHref', () => {
  it('pins study mode by text id, carries the chunk id, and prefills a generic question', () => {
    const href = askAboutHref('dhammapada-chapter-01', 'The Dhammapada, Chapter V', 'buddhism.dhammapada-chapter-05.002');
    expect(href).toMatch(/^\/chat\?study=dhammapada-chapter-01&q=/);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('chunk')).toBe('buddhism.dhammapada-chapter-05.002');
    expect(params.get('q')).toBe('What is the meaning of this passage from The Dhammapada, Chapter V?');
  });

  it('never quotes internal section notation in the question (todo:76219c57)', () => {
    // The chunk itself now rides ?chunk= into the model's context, so the
    // question must not lean on section labels like "Section 13 (part 64)" —
    // they're our chunking metadata, meaningless to the text and the model.
    const q = new URLSearchParams(
      askAboutHref('golden-verses-0', 'The Golden Verses of Pythagoras', 'greek_mystery.pythagorean-golden-verses.097').split('?')[1],
    ).get('q');
    expect(q).not.toMatch(/Section|part/);
  });
});

describe('getChunkPage pin_text_id', () => {
  it("exposes the work's FIRST member, not the chunk's own text", async () => {
    mOne.mockResolvedValueOnce({
      id: 'buddhism.dhammapada-chapter-05.002', text_id: 'dhammapada-chapter-05',
      tradition: 'buddhism', text_name: 'The Dhammapada, Chapter V', section: 'Verse 62',
      translator: null, body: 'x', token_count: 1, text_label: 'The Dhammapada, Chapter V',
      source_url: null, sections_format: 'verse', work_id: 'dhammapada',
      tradition_label: 'Buddhism',
      member_text_ids: ['dhammapada-chapter-01', 'dhammapada-chapter-05'],
    } as never);
    mOne.mockResolvedValue({ id: 'buddhism.dhammapada-chapter-05.001', section: 'V.61', total: 2, pos: 2 } as never);
    const page = await getChunkPage('buddhism.dhammapada-chapter-05.002');
    expect(page?.pin_text_id).toBe('dhammapada-chapter-01');
  });
});

describe('getChunkById (pinned-passage fetch)', () => {
  const ROW = {
    id: 'greek_mystery.pythagorean-golden-verses.097', text_id: 'golden-verses-0',
    tradition: 'greek_mystery', text_name: 'The Golden Verses of Pythagoras',
    section: 'Section 13 (part 64)', translator: null, body: 'theogony',
    token_count: 3, source: 'vector',
  };

  it("tags the row pinned and tier 'inferred' — same as any vector hit", async () => {
    mOne.mockResolvedValueOnce(ROW as never);
    const out = await getChunkById(ROW.id);
    expect(out?.pinned).toBe(true);
    // Without an explicit tier, the citations header's `?? 'verified'`
    // fallback would stamp the pin with the highest-trust label while
    // formatChunk shows 'inferred' in the prompt.
    expect(out?.tier).toBe('inferred');
  });

  it('fail-open: an unknown id returns null', async () => {
    mOne.mockResolvedValueOnce(null as never);
    expect(await getChunkById('gone.text.999')).toBeNull();
  });
});

describe('chat-view seed handling (source shape)', () => {
  const SRC = readFileSync('src/components/chat-view.tsx', 'utf8');

  it('reads and strips ?study=, ?q= and ?chunk= in the param effect', () => {
    expect(SRC).toMatch(/params\.get\('study'\)/);
    expect(SRC).toMatch(/params\.get\('q'\)/);
    expect(SRC).toMatch(/params\.get\('chunk'\)/);
    expect(SRC).toMatch(/params\.delete\('study'\)/);
    expect(SRC).toMatch(/params\.delete\('q'\)/);
    expect(SRC).toMatch(/params\.delete\('chunk'\)/);
  });

  it('sends the pin as pinned_chunk_id and spends it only when the server accepts (one-shot, non-429)', () => {
    expect(SRC).toMatch(/pinned_chunk_id: pinned/);
    // The pin must survive a 429 (1s debounce or daily cap — no model call
    // happened, so a retry of the SAME first question still needs the
    // passage) and a network failure. So consumption comes AFTER the fetch
    // and AFTER the 429 early-return; from there follow-ups revert to
    // plain retrieval.
    const consumeAt = SRC.indexOf('setPinnedChunkId(null)');
    const fetchAt   = SRC.indexOf("fetch('/api/query'");
    const deny429At = SRC.indexOf('res.status === 429');
    expect(consumeAt).toBeGreaterThan(-1);
    expect(consumeAt).toBeGreaterThan(fetchAt);
    expect(consumeAt).toBeGreaterThan(deny429At);
  });

  it('prefills the input but never auto-sends', () => {
    expect(SRC).toMatch(/if \(seedQ\) setInput\(seedQ\);/);
    // The seed path must not call the send handler.
    const effect = SRC.slice(SRC.indexOf("params.get('study')"), SRC.indexOf("params.get('study')") + 700);
    expect(effect).not.toMatch(/handleSend|sendMessage|submit/i);
  });
});
