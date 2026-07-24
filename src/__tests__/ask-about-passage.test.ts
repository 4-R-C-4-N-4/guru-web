/**
 * src/__tests__/ask-about-passage.test.ts
 *
 * The reader→chat loop-closer (todo:7b60b6fb). Three contracts:
 * askAboutHref builds a /chat deep link pinned via the WORK's pin text id
 * with a prefilled question; getChunkPage exposes that pin (the work's
 * first member — a chunk in Dhammapada ch. 5 must pin ch. 1); chat-view
 * consumes ?study= and ?q= in its param-strip effect without auto-sending.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { readFileSync } from 'node:fs';
import { askAboutHref } from '@/lib/read-path';

vi.mock('@/lib/db', () => ({ query: vi.fn(), one: vi.fn(), exec: vi.fn() }));

import { getChunkPage } from '@/lib/reader';
import { one } from '@/lib/db';

const mOne = one as MockedFunction<typeof one>;

beforeEach(() => vi.clearAllMocks());

describe('askAboutHref', () => {
  it('pins study mode by text id and prefills a question naming the passage', () => {
    const href = askAboutHref('dhammapada-chapter-01', 'The Dhammapada, Chapter V', 'Verse 62');
    expect(href).toMatch(/^\/chat\?study=dhammapada-chapter-01&q=/);
    const q = new URLSearchParams(href.split('?')[1]).get('q');
    expect(q).toContain('"Verse 62"');
    expect(q).toContain('The Dhammapada, Chapter V');
  });

  it('degrades to the text label alone when the chunk has no section', () => {
    const q = new URLSearchParams(askAboutHref('tao-te-ching', 'Tao Te Ching', null).split('?')[1]).get('q');
    expect(q).toBe('What is the meaning of Tao Te Ching?');
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

describe('chat-view seed handling (source shape)', () => {
  const SRC = readFileSync('src/components/chat-view.tsx', 'utf8');

  it('reads and strips ?study= and ?q= in the param effect', () => {
    expect(SRC).toMatch(/params\.get\('study'\)/);
    expect(SRC).toMatch(/params\.get\('q'\)/);
    expect(SRC).toMatch(/params\.delete\('study'\)/);
    expect(SRC).toMatch(/params\.delete\('q'\)/);
  });

  it('prefills the input but never auto-sends', () => {
    expect(SRC).toMatch(/if \(seedQ\) setInput\(seedQ\);/);
    // The seed path must not call the send handler.
    const effect = SRC.slice(SRC.indexOf("params.get('study')"), SRC.indexOf("params.get('study')") + 700);
    expect(effect).not.toMatch(/handleSend|sendMessage|submit/i);
  });
});
