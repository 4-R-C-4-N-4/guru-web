/**
 * src/__tests__/admin-queries.test.ts
 *
 * Endpoint contract for /api/admin/queries/[id], plus a smoke check
 * on the ExpandableQuery component (the spec is "Ctrl-F searches the
 * collapsed text," which translates to "the full prompt is in the
 * DOM even when the <details> is closed").
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpandableQuery } from '@/components/admin/ExpandableQuery';

vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(),
  isAdmin:      vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/admin-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-queries')>('@/lib/admin-queries');
  return { ...actual, getQueryDeepDive: vi.fn() };
});

import * as admin from '@/lib/admin';
import * as adminQ from '@/lib/admin-queries';
const mockRequireAdmin = admin.requireAdmin     as MockedFunction<typeof admin.requireAdmin>;
const mockGetQuery     = adminQ.getQueryDeepDive as MockedFunction<typeof adminQ.getQueryDeepDive>;

const ADMIN = { id: 'user_admin', email: 'op@x', tier: 'pro' as const, stripe_customer_id: null, payment_state: null };

const QUERY_ROW = {
  id: 'q1', query_text: 'searchable distinctive marker phrase',
  response_text: 'response text body', chunks_used: [],
  model_used: 'openai/gpt-4o', tier_used: 'free' as const,
  input_tokens: 100, output_tokens: 50, cached_input_tokens: 0,
  cost_usd: 0.001, created_at: '2026-04-01T00:00:00Z',
  pricing_input_per_mtok: 2.5, pricing_output_per_mtok: 10,
  pricing_cached_input_per_mtok: null, pricing_effective_from: '2026-03-01T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/admin/queries/[id]', () => {
  it('404s non-admins', async () => {
    mockRequireAdmin.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { GET } = await import('@/app/api/admin/queries/[id]/route');
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'q1' }) });
    expect(res.status).toBe(404);
  });

  it('returns query + raw row payload', async () => {
    mockRequireAdmin.mockResolvedValueOnce(ADMIN);
    mockGetQuery.mockResolvedValueOnce({
      query: { ...QUERY_ROW, session_id: 's1', user_id: 'u1', user_email: 'a@b.c' },
      raw: { id: 'q1', custom_internal: 'visible-in-raw' },
    });
    const { GET } = await import('@/app/api/admin/queries/[id]/route');
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'q1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query.id).toBe('q1');
    expect(body.raw.custom_internal).toBe('visible-in-raw');
  });
});

describe('<ExpandableQuery>', () => {
  it('renders the full prompt + response in the DOM (so Ctrl-F works on collapsed views)', () => {
    const html = renderToStaticMarkup(<ExpandableQuery query={QUERY_ROW} />);
    expect(html).toContain('searchable distinctive marker phrase');
    expect(html).toContain('response text body');
    // <details> defaults to closed (no 'open' attribute).
    expect(html).not.toMatch(/<details[^>]*\sopen(=|[\s>])/);
  });

  it('opens by default when defaultOpen is true', () => {
    const html = renderToStaticMarkup(<ExpandableQuery query={QUERY_ROW} defaultOpen />);
    expect(html).toMatch(/<details[^>]*\sopen(=|[\s>])/);
  });

  it('renders the model_pricing rates in the costing block', () => {
    const html = renderToStaticMarkup(<ExpandableQuery query={QUERY_ROW} />);
    expect(html).toContain('$2.5000');  // input rate
    expect(html).toContain('$10.0000'); // output rate
  });
});
