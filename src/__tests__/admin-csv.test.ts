/**
 * src/__tests__/admin-csv.test.ts
 *
 * Tests for the streaming CSV helper + the /api/admin/users.csv
 * endpoint. The streaming property is what we care about most: the
 * header chunk must be emitted before the row chunks, and the row
 * chunks must arrive separately.
 *
 * Spec: BRD-admin-ui §1.18, IMPL §5.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { csvEscape, csvLine, streamingCsv } from '@/components/admin/csv';

vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(),
  isAdmin:      vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/admin-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-queries')>('@/lib/admin-queries');
  return { ...actual, listUsers: vi.fn() };
});

import * as admin from '@/lib/admin';
import * as adminQ from '@/lib/admin-queries';
const mockRequireAdmin = admin.requireAdmin as MockedFunction<typeof admin.requireAdmin>;
const mockListUsers    = adminQ.listUsers   as MockedFunction<typeof adminQ.listUsers>;

beforeEach(() => vi.clearAllMocks());

describe('csv helpers', () => {
  it('escapes commas, quotes, and newlines per RFC 4180', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(42)).toBe('42');
  });

  it('csvLine joins escaped cells with comma + CRLF', () => {
    expect(csvLine(['a', 'b,c', 1])).toBe('a,"b,c",1\r\n');
  });
});

describe('streamingCsv()', () => {
  it('emits header as the first chunk, separate from row chunks', async () => {
    const batches = (async function* () {
      yield [['r1a', 'r1b']];
      yield [['r2a', 'r2b'], ['r3a', 'r3b']];
    })();
    const res = streamingCsv('test.csv', ['col1', 'col2'], batches);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toContain('attachment');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const chunks: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toBe('col1,col2\r\n');
    // Subsequent chunks contain row data.
    const tail = chunks.slice(1).join('');
    expect(tail).toContain('r1a,r1b');
    expect(tail).toContain('r3a,r3b');
  });

  it('skips empty batches', async () => {
    const batches = (async function* () {
      yield [];
      yield [['x']];
    })();
    const res = streamingCsv('t.csv', ['c'], batches);
    const text = await res.text();
    expect(text).toBe('c\r\nx\r\n');
  });
});

describe('GET /api/admin/users.csv', () => {
  it('404s non-admins', async () => {
    mockRequireAdmin.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { GET } = await import('@/app/api/admin/users.csv/route');
    const res = await GET(new Request('http://localhost/api/admin/users.csv'));
    expect(res.status).toBe(404);
    expect(mockListUsers).not.toHaveBeenCalled();
  });

  it('streams headers then rows, paginating until short batch', async () => {
    mockRequireAdmin.mockResolvedValueOnce({
      id: 'user_admin', email: 'op@x', tier: 'pro', stripe_customer_id: null, payment_state: null,
    });
    // First page returns a "full" batch — but we use smaller batch
    // sizes via a single short return for the test. The route uses
    // BATCH_SIZE=1000; a single 1-row return ends the loop.
    mockListUsers.mockResolvedValueOnce([{
      id: 'u1', email: 'a@b.c', tier: 'free', stripe_customer_id: null,
      created_at: '2026-04-01T00:00:00Z', last_query_at: null,
      queries_7d: 0, spend_7d: 0,
    }]);

    const { GET } = await import('@/app/api/admin/users.csv/route');
    const res = await GET(new Request('http://localhost/api/admin/users.csv'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.split('\r\n')[0]).toBe('user_id,email,tier,stripe_customer_id,created_at,last_query_at,queries_7d,spend_7d');
    expect(text).toContain('u1,a@b.c,free,');
    // Loop should have stopped after the short batch — exactly one call.
    expect(mockListUsers).toHaveBeenCalledTimes(1);
  });
});
