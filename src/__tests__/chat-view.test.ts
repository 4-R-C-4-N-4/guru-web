/**
 * src/__tests__/chat-view.test.ts
 *
 * Tests for the shared chat view (todo:45a8b6bc).
 *   - recordsToMessages: pure transform from persisted QueryRecord rows
 *     into the in-memory Message[] the UI renders.
 *   - URL-update contract: first-message URL change must use
 *     window.history.replaceState, NOT next/navigation router.replace.
 *     If a real route change fires, the App Router unmounts /chat and
 *     mounts /chat/[sessionId] — losing the in-flight stream and
 *     dropping the response into the resume stub.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { recordsToMessages } from '@/components/chat-view';

describe('recordsToMessages', () => {
  it('returns [] for empty input', () => {
    expect(recordsToMessages([])).toEqual([]);
  });

  it('expands one QueryRecord into a user + assistant pair', () => {
    const out = recordsToMessages([
      { query_text: 'What is gnosis?', response_text: 'Direct knowing.' },
    ]);
    expect(out).toEqual([
      { role: 'user',      content: 'What is gnosis?' },
      { role: 'assistant', text:    'Direct knowing.' },
    ]);
  });

  it('preserves order across multiple records', () => {
    const out = recordsToMessages([
      { query_text: 'Q1', response_text: 'A1' },
      { query_text: 'Q2', response_text: 'A2' },
    ]);
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(out[0]!.content).toBe('Q1');
    expect(out[1]!.text).toBe('A1');
    expect(out[2]!.content).toBe('Q2');
    expect(out[3]!.text).toBe('A2');
  });

  it('omits citations when the API returned none (back-compat for old sessions)', () => {
    const out = recordsToMessages([
      { query_text: 'Q', response_text: 'A' },
    ]);
    expect(out[1]!.citations).toBeUndefined();
    expect(out[1]!.meta).toBeUndefined();
  });

  it('passes citations through to the assistant message (todo:89af833a)', () => {
    const citations = [
      { tradition: 'gnosticism', text: 'Gospel of Philip', section: '78', tier: 'verified' as const },
    ];
    const out = recordsToMessages([
      { query_text: 'Q', response_text: 'A', citations },
    ]);
    expect(out[1]!.role).toBe('assistant');
    expect(out[1]!.citations).toEqual(citations);
    // User messages never get citations (the user typed the question).
    expect(out[0]!.citations).toBeUndefined();
  });
});

describe('chat-view markdown rendering', () => {
  // Source-level guards. Locks in that assistant messages render through
  // react-markdown with remark-gfm and that user messages stay plain
  // text (the user typed those literally; we don't want their **stars**
  // turning into <strong>). Catches a future refactor that drops the
  // markdown wrapper.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    resolve(__dirname, '../components/chat-view.tsx'),
    'utf8',
  );

  it('imports react-markdown + remark-gfm', () => {
    expect(SRC).toMatch(/import\s+ReactMarkdown.*from\s+['"]react-markdown['"]/);
    expect(SRC).toMatch(/import\s+remarkGfm\s+from\s+['"]remark-gfm['"]/);
  });

  it('wraps the assistant text in <ReactMarkdown> with remarkGfm', () => {
    // The assistant render path uses ReactMarkdown; remarkGfm is passed
    // in remarkPlugins so tables/strikethrough/task lists/autolinks work.
    expect(SRC).toMatch(/<ReactMarkdown[^>]*remarkPlugins=\{\[remarkGfm\]\}/);
    expect(SRC).toMatch(/\{msg\.text\s*\?\?\s*['"]{2}\}\s*<\/ReactMarkdown>/);
  });

  it('user messages render as plain text (not through markdown)', () => {
    // The user branch should still render {msg.content} directly.
    expect(SRC).toMatch(/\{msg\.content\}/);
  });
});

describe('chat-view URL-update contract', () => {
  // Source-level guards. The chat UI is React + DOM-heavy; we don't have
  // a DOM test harness configured. These string checks are blunt but
  // sufficient to lock in the regression: a router.replace into the
  // [sessionId] route swaps components and loses the in-flight stream.

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    resolve(__dirname, '../components/chat-view.tsx'),
    'utf8',
  );

  it('uses window.history.replaceState to update the URL on first message', () => {
    expect(SRC).toMatch(/window\.history\.replaceState\(/);
  });

  it('does not call router.replace or router.push for /chat/<id>', () => {
    expect(SRC).not.toMatch(/router\.replace\s*\(/);
    expect(SRC).not.toMatch(/router\.push\s*\(\s*[`'"]\/chat\//);
  });
});
