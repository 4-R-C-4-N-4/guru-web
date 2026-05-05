/**
 * src/__tests__/admin-sessions.test.ts
 *
 * Endpoint contract for /api/admin/sessions/[id] and the
 * /queries.csv export.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(),
  isAdmin:      vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/admin-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-queries')>('@/lib/admin-queries');
  return { ...actual, getSessionDeepDive: vi.fn() };
});

import * as admin from '@/lib/admin';
import * as adminQ from '@/lib/admin-queries';
const mockRequireAdmin = admin.requireAdmin       as MockedFunction<typeof admin.requireAdmin>;
const mockGetSession   = adminQ.getSessionDeepDive as MockedFunction<typeof adminQ.getSessionDeepDive>;

const ADMIN = { id: 'user_admin', email: 'op@x', tier: 'pro' as const, stripe_customer_id: null, payment_state: null };

const SESSION_FIXTURE = {
  session: {
    id: 's1', title: 'foo', user_id: 'u1', user_email: 'a@b.c',
    created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T01:00:00Z',
  },
  totals: { query_count: 1, spend: 0.05, input_tokens: 100, output_tokens: 200, cached_input_tokens: 0 },
  queries: [{
    id: 'q1', query_text: 'hi, comma "and" newline\n', response_text: 'ok',
    chunks_used: [{ tradition: 'hermeticism', text_name: 'foo', section: '1.2' }],
    model_used: 'anthropic/claude-sonnet-4.5', tier_used: 'pro' as const,
    input_tokens: 100, output_tokens: 200, cached_input_tokens: 0, cost_usd: 0.05,
    created_at: '2026-04-01T00:30:00Z',
    pricing_input_per_mtok: 3, pricing_output_per_mtok: 15,
    pricing_cached_input_per_mtok: 0.3, pricing_effective_from: '2026-03-01T00:00:00Z',
  }],
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/admin/sessions/[id]', () => {
  it('404s non-admins', async () => {
    mockRequireAdmin.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { GET } = await import('@/app/api/admin/sessions/[id]/route');
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(404);
  });

  it('404s when session is missing', async () => {
    mockRequireAdmin.mockResolvedValueOnce(ADMIN);
    mockGetSession.mockResolvedValueOnce(null);
    const { GET } = await import('@/app/api/admin/sessions/[id]/route');
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('returns full payload', async () => {
    mockRequireAdmin.mockResolvedValueOnce(ADMIN);
    mockGetSession.mockResolvedValueOnce(SESSION_FIXTURE);
    const { GET } = await import('@/app/api/admin/sessions/[id]/route');
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe('s1');
    expect(body.queries[0].pricing_input_per_mtok).toBe(3);
  });
});

describe('GET /api/admin/sessions/[id]/queries.csv', () => {
  it('streams CSV with model_pricing columns', async () => {
    mockRequireAdmin.mockResolvedValueOnce(ADMIN);
    mockGetSession.mockResolvedValueOnce(SESSION_FIXTURE);

    const { GET } = await import('@/app/api/admin/sessions/[id]/queries.csv/route');
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    const [header, ...rows] = text.split('\r\n');
    expect(header).toContain('price_input_per_mtok');
    expect(header).toContain('pricing_effective_from');
    // First row contains the model id and quoted query text.
    expect(rows[0]).toContain('anthropic/claude-sonnet-4.5');
    expect(rows[0]).toContain('"hi, comma ""and"" newline\n"');
  });
});
