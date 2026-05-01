/**
 * src/__tests__/admin-users.test.ts
 *
 * URL-param parsing + endpoint contract for the users routes.
 *
 * Strategy: mock requireAdmin and the admin-queries listUsers /
 * countUsers helpers. Assert: filter / sort URL state → expected
 * params object; 404 to non-admins; JSON shape; row navigation.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(),
  isAdmin:      vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/admin-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-queries')>('@/lib/admin-queries');
  return {
    ...actual,
    listUsers:        vi.fn(),
    countUsers:       vi.fn(),
    getUserDeepDive:  vi.fn(),
    listUserSessions: vi.fn(),
  };
});

import * as admin from '@/lib/admin';
import * as adminQ from '@/lib/admin-queries';
const mockRequireAdmin    = admin.requireAdmin       as MockedFunction<typeof admin.requireAdmin>;
const mockListUsers       = adminQ.listUsers         as MockedFunction<typeof adminQ.listUsers>;
const mockCountUsers      = adminQ.countUsers        as MockedFunction<typeof adminQ.countUsers>;
const mockGetUser         = adminQ.getUserDeepDive   as MockedFunction<typeof adminQ.getUserDeepDive>;
const mockListSessions    = adminQ.listUserSessions  as MockedFunction<typeof adminQ.listUserSessions>;

beforeEach(() => vi.clearAllMocks());

const ADMIN = { id: 'user_admin', email: 'op@x', tier: 'pro' as const, stripe_customer_id: null };

describe('parseUserListSearchParams', () => {
  it('round-trips defaults when no params are set', async () => {
    const { parseUserListSearchParams } = await import('@/app/api/admin/user-params');
    const out = parseUserListSearchParams(new URLSearchParams());
    expect(out.filters.tier).toBe('all');
    expect(out.filters.createdAfter).toBeNull();
    expect(out.filters.queriedWithinDays).toBeNull();
    expect(out.filters.search).toBeNull();
    expect(out.sort.by).toBe('last_query_at');
    expect(out.sort.dir).toBe('desc');
    expect(out.page).toBe(0);
  });

  it('parses every supported filter value', async () => {
    const { parseUserListSearchParams } = await import('@/app/api/admin/user-params');
    const out = parseUserListSearchParams(new URLSearchParams('tier=pro&created=7d&queried=never&q=alice&sort=spend_7d&dir=asc&page=3'));
    expect(out.filters.tier).toBe('pro');
    expect(out.filters.createdAfter).toBeTypeOf('string');
    expect(out.filters.queriedWithinDays).toBe(-1);
    expect(out.filters.search).toBe('alice');
    expect(out.sort.by).toBe('spend_7d');
    expect(out.sort.dir).toBe('asc');
    expect(out.page).toBe(3);
  });

  it('drops unknown sort columns and clamps negative page', async () => {
    const { parseUserListSearchParams } = await import('@/app/api/admin/user-params');
    const out = parseUserListSearchParams(new URLSearchParams('sort=foo&page=-5'));
    expect(out.sort.by).toBe('last_query_at');
    expect(out.page).toBe(0);
  });
});

describe('GET /api/admin/users', () => {
  it('returns 404 to non-admins', async () => {
    mockRequireAdmin.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { GET } = await import('@/app/api/admin/users/route');
    const res = await GET(new Request('http://localhost/api/admin/users'));
    expect(res.status).toBe(404);
    expect(mockListUsers).not.toHaveBeenCalled();
  });

  it('returns paginated list with total to admins', async () => {
    mockRequireAdmin.mockResolvedValueOnce(ADMIN);
    mockListUsers.mockResolvedValueOnce([{
      id: 'u1', email: 'a@b.c', tier: 'free', stripe_customer_id: null,
      created_at: '2026-04-01T00:00:00Z', last_query_at: null,
      queries_7d: 0, spend_7d: 0,
    }]);
    mockCountUsers.mockResolvedValueOnce(1);

    const { GET } = await import('@/app/api/admin/users/route');
    const res = await GET(new Request('http://localhost/api/admin/users?tier=free'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.pageSize).toBe(50);
  });
});

describe('GET /api/admin/users/[id]', () => {
  it('404s when user not found', async () => {
    mockRequireAdmin.mockResolvedValueOnce(ADMIN);
    mockGetUser.mockResolvedValueOnce(null);
    mockListSessions.mockResolvedValueOnce([]);
    const { GET } = await import('@/app/api/admin/users/[id]/route');
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('returns deep-dive payload for existing user', async () => {
    mockRequireAdmin.mockResolvedValueOnce(ADMIN);
    mockGetUser.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a@b.c', tier: 'pro', stripe_customer_id: 'cus_x', created_at: '2026-01-01' },
      lifetime: { queries: 5, spend: 0.1, input_tokens: 100, output_tokens: 200 },
      budgets: [{ period: 'daily', query_limit: 30, queries_used: 3, usd_limit: null, usd_used: 0.05 }],
      preferences: null,
      rate_limits: [],
    });
    mockListSessions.mockResolvedValueOnce([{
      id: 's1', title: 't', created_at: '2026-04-01', updated_at: '2026-04-02', query_count: 2, spend: 0.05,
    }]);

    const { GET } = await import('@/app/api/admin/users/[id]/route');
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'u1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe('u1');
    expect(body.budgets[0].usd_limit).toBeNull();
    expect(body.sessions[0].id).toBe('s1');
  });
});
