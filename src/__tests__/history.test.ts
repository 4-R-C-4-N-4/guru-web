/**
 * src/__tests__/history.test.ts
 *
 * Unit tests for loadSessionHistory. The DB layer is mocked.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  one:   vi.fn(),
  exec:  vi.fn(),
}));

import * as db from '@/lib/db';
import { loadSessionHistory } from '@/lib/history';

const mockQuery = db.query as MockedFunction<typeof db.query>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadSessionHistory', () => {
  it('returns [] for a session with no queries', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await loadSessionHistory('s1');
    expect(result).toEqual([]);
  });

  it('returns 4 messages for a two-turn session in chronological order', async () => {
    mockQuery.mockResolvedValueOnce([
      { query_text: 'q1', response_text: 'a1' },
      { query_text: 'q2', response_text: 'a2' },
    ]);
    const result = await loadSessionHistory('s1');
    expect(result).toEqual([
      { role: 'user',      content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user',      content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ]);
  });

  it('skips rows with empty response_text (errored streams)', async () => {
    mockQuery.mockResolvedValueOnce([
      { query_text: 'q1', response_text: 'a1' },
      { query_text: 'q2', response_text: '' },          // errored
      { query_text: 'q3', response_text: 'a3' },
    ]);
    const result = await loadSessionHistory('s1');
    expect(result).toEqual([
      { role: 'user',      content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user',      content: 'q3' },
      { role: 'assistant', content: 'a3' },
    ]);
  });

  it('prunes by maxTurns (drops oldest pairs)', async () => {
    // 4 pairs (8 messages), cap at maxTurns = 6 (3 pairs) → drop pair 1
    mockQuery.mockResolvedValueOnce([
      { query_text: 'q1', response_text: 'a1' },
      { query_text: 'q2', response_text: 'a2' },
      { query_text: 'q3', response_text: 'a3' },
      { query_text: 'q4', response_text: 'a4' },
    ]);
    const result = await loadSessionHistory('s1', { maxTurns: 6 });
    expect(result.length).toBe(6);
    expect(result[0]).toEqual({ role: 'user',      content: 'q2' });
    expect(result[5]).toEqual({ role: 'assistant', content: 'a4' });
  });

  it('prunes by maxTokens (drops oldest pairs)', async () => {
    // Each pair has ~80 chars total (~20 tokens); maxTokens=10 (40 chars budget)
    // → only the most recent pair fits.
    mockQuery.mockResolvedValueOnce([
      { query_text: 'q'.repeat(20), response_text: 'a'.repeat(20) },
      { query_text: 'q'.repeat(20), response_text: 'a'.repeat(20) },
      { query_text: 'short', response_text: 'reply' },     // 10 chars total, fits the 40-char budget
    ]);
    const result = await loadSessionHistory('s1', { maxTurns: 100, maxTokens: 10 });
    expect(result.length).toBe(2);
    expect(result[0].content).toBe('short');
    expect(result[1].content).toBe('reply');
  });

  it('is pair-atomic: never returns an orphan assistant at index 0', async () => {
    mockQuery.mockResolvedValueOnce([
      { query_text: 'q1', response_text: 'a1' },
      { query_text: 'q2', response_text: 'a2' },
      { query_text: 'q3', response_text: 'a3' },
    ]);
    // Cap that would leave 1.5 pairs in a non-atomic implementation
    const result = await loadSessionHistory('s1', { maxTurns: 3 });
    // maxPairs = floor(3/2) = 1 → only the most recent pair survives
    expect(result.length).toBe(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  it('issues SQL ordered by created_at ASC against the queries table', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await loadSessionHistory('s-abc');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM queries/);
    expect(sql).toMatch(/WHERE session_id = \$1/);
    expect(sql).toMatch(/ORDER BY created_at ASC/);
    expect(params).toEqual(['s-abc']);
  });
});
