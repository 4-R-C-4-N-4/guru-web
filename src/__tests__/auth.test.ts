/**
 * src/__tests__/auth.test.ts
 *
 * Unit tests for auth helpers and Clerk webhook handler.
 *
 * requireUser() and requireTier() depend on Clerk's auth() which needs a
 * real request context — those are tested via integration tests or e2e.
 * Here we test the webhook handler logic directly by mocking dependencies.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

// ---------------------------------------------------------------------------
// Mock lib/db so no real Postgres connection is needed
// ---------------------------------------------------------------------------
vi.mock('@/lib/db', () => ({
  exec: vi.fn(),
  one:  vi.fn(),
}));

import * as db from '@/lib/db';
const mockExec = db.exec as MockedFunction<typeof db.exec>;
const mockOne  = db.one  as MockedFunction<typeof db.one>;

// ---------------------------------------------------------------------------
// Mock svix Webhook — we test our logic, not svix's crypto
// ---------------------------------------------------------------------------
vi.mock('svix', () => {
  class Webhook {
    verify(payload: string) {
      return JSON.parse(payload);
    }
  }
  return { Webhook };
});

// ---------------------------------------------------------------------------
// Mock Clerk auth() so requireUser() can be exercised in unit tests
// ---------------------------------------------------------------------------
vi.mock('@clerk/nextjs/server', () => ({
  auth:        vi.fn(),
  currentUser: vi.fn(),
}));

import { auth as clerkAuth, currentUser as clerkCurrentUser } from '@clerk/nextjs/server';
const mockClerkAuth        = clerkAuth        as MockedFunction<typeof clerkAuth>;
const mockClerkCurrentUser = clerkCurrentUser as MockedFunction<typeof clerkCurrentUser>;

// ---------------------------------------------------------------------------
// Mock next/headers
// ---------------------------------------------------------------------------
vi.mock('next/headers', () => ({
  headers: vi.fn(() => ({
    get: (key: string) => {
      const map: Record<string, string> = {
        'svix-id':        'msg_test_123',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,fakesig',
      };
      return map[key] ?? null;
    },
  })),
}));

// ---------------------------------------------------------------------------
// Import handlers after mocks are in place
// ---------------------------------------------------------------------------
const { POST } = await import('@/app/api/webhooks/clerk/route');
const { requireUser } = await import('@/lib/auth');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(body: object): Request {
  return new Request('http://localhost/api/webhooks/clerk', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'svix-id':        'msg_test_123',
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,fakesig',
    },
  });
}

const USER_DATA = {
  id: 'user_abc123',
  email_addresses: [{ email_address: 'test@example.com', id: 'ea_1' }],
  primary_email_address_id: 'ea_1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/webhooks/clerk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure CLERK_WEBHOOK_SECRET is set
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test';
  });

  it('user.created: inserts a new user row', async () => {
    mockExec.mockResolvedValueOnce(undefined);

    const req = makeRequest({ type: 'user.created', data: USER_DATA });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(mockExec).toHaveBeenCalledOnce();
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain('INSERT INTO users');
    expect(params).toContain('user_abc123');
    expect(params).toContain('test@example.com');
  });

  it('user.updated: updates email in users table', async () => {
    mockExec.mockResolvedValueOnce(undefined);

    const req = makeRequest({ type: 'user.updated', data: USER_DATA });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockExec).toHaveBeenCalledOnce();
    const [sql] = mockExec.mock.calls[0];
    expect(sql).toContain('UPDATE users SET email');
  });

  it('user.deleted: soft-deletes existing user', async () => {
    mockOne.mockResolvedValueOnce({ id: 'user_abc123' });
    mockExec.mockResolvedValueOnce(undefined);

    const req = makeRequest({
      type: 'user.deleted',
      data: { ...USER_DATA, deleted: true },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockExec).toHaveBeenCalledOnce();
    const [sql] = mockExec.mock.calls[0];
    expect(sql).toContain('deleted_at');
  });

  it('user.deleted: no-ops if user does not exist', async () => {
    mockOne.mockResolvedValueOnce(null);

    const req = makeRequest({
      type: 'user.deleted',
      data: { ...USER_DATA, deleted: true },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('user.created: 400 if no email address', async () => {
    const req = makeRequest({
      type: 'user.created',
      data: { id: 'user_noemail', email_addresses: [], primary_email_address_id: '' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 if CLERK_WEBHOOK_SECRET is missing', async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const req = makeRequest({ type: 'user.created', data: USER_DATA });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

describe('requireUser()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when Clerk reports no signed-in user', async () => {
    mockClerkAuth.mockResolvedValueOnce({ userId: null } as never);

    const result = await requireUser();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(mockOne).not.toHaveBeenCalled();
  });

  it('returns the user record when active (deleted_at IS NULL)', async () => {
    mockClerkAuth.mockResolvedValueOnce({ userId: 'user_live' } as never);
    mockOne.mockResolvedValueOnce({
      id: 'user_live', email: 'a@b.com', tier: 'free', stripe_customer_id: null, payment_state: null,
    });

    const result = await requireUser();
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { id: string }).id).toBe('user_live');
    // Single SELECT, no upsert needed.
    expect(mockOne).toHaveBeenCalledOnce();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('initial SELECT excludes soft-deleted users via deleted_at IS NULL', async () => {
    mockClerkAuth.mockResolvedValueOnce({ userId: 'user_x' } as never);
    mockOne.mockResolvedValueOnce(null);
    mockClerkCurrentUser.mockResolvedValueOnce(null as never);

    await requireUser();

    const [sql, params] = mockOne.mock.calls[0]!;
    expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(params).toEqual(['user_x']);
  });

  describe('lazy upsert when DB row is missing (todo:a7ffea2b)', () => {
    it('upserts from currentUser() and returns the new row', async () => {
      mockClerkAuth.mockResolvedValueOnce({ userId: 'user_new' } as never);
      // First SELECT: no row.
      mockOne.mockResolvedValueOnce(null);
      // Clerk has the user with an email.
      mockClerkCurrentUser.mockResolvedValueOnce({
        id: 'user_new',
        primaryEmailAddress: { emailAddress: 'new@example.com' },
        emailAddresses: [{ emailAddress: 'new@example.com' }],
      } as never);
      mockExec.mockResolvedValueOnce(undefined);
      // Re-SELECT after upsert: row now exists.
      mockOne.mockResolvedValueOnce({
        id: 'user_new', email: 'new@example.com', tier: 'free', stripe_customer_id: null, payment_state: null,
      });

      const result = await requireUser();
      expect(result).not.toBeInstanceOf(Response);
      expect((result as { id: string }).id).toBe('user_new');

      // Verify the upsert SQL shape.
      expect(mockExec).toHaveBeenCalledOnce();
      const [sql, params] = mockExec.mock.calls[0]!;
      expect(sql).toMatch(/INSERT INTO users/);
      expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
      expect(params).toEqual(['user_new', 'new@example.com']);
    });

    it('falls back to emailAddresses[0] when primaryEmailAddress is absent', async () => {
      mockClerkAuth.mockResolvedValueOnce({ userId: 'user_alt' } as never);
      mockOne.mockResolvedValueOnce(null);
      mockClerkCurrentUser.mockResolvedValueOnce({
        id: 'user_alt',
        primaryEmailAddress: null,
        emailAddresses: [{ emailAddress: 'alt@example.com' }],
      } as never);
      mockExec.mockResolvedValueOnce(undefined);
      mockOne.mockResolvedValueOnce({
        id: 'user_alt', email: 'alt@example.com', tier: 'free', stripe_customer_id: null, payment_state: null,
      });

      const result = await requireUser();
      expect(result).not.toBeInstanceOf(Response);
      expect(mockExec.mock.calls[0]![1]).toEqual(['user_alt', 'alt@example.com']);
    });

    it('returns 401 when Clerk has no current record (stale session)', async () => {
      mockClerkAuth.mockResolvedValueOnce({ userId: 'user_stale' } as never);
      mockOne.mockResolvedValueOnce(null);
      mockClerkCurrentUser.mockResolvedValueOnce(null as never);

      const result = await requireUser();
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('returns 401 when Clerk user has no email address at all', async () => {
      mockClerkAuth.mockResolvedValueOnce({ userId: 'user_noemail' } as never);
      mockOne.mockResolvedValueOnce(null);
      mockClerkCurrentUser.mockResolvedValueOnce({
        id: 'user_noemail',
        primaryEmailAddress: null,
        emailAddresses: [],
      } as never);

      const result = await requireUser();
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('returns 401 when ON CONFLICT no-op leaves the row absent (soft-deleted)', async () => {
      mockClerkAuth.mockResolvedValueOnce({ userId: 'user_softdel' } as never);
      mockOne.mockResolvedValueOnce(null);
      mockClerkCurrentUser.mockResolvedValueOnce({
        id: 'user_softdel',
        primaryEmailAddress: { emailAddress: 'sd@example.com' },
        emailAddresses: [{ emailAddress: 'sd@example.com' }],
      } as never);
      mockExec.mockResolvedValueOnce(undefined);
      // Re-SELECT still null because the existing row has deleted_at set.
      mockOne.mockResolvedValueOnce(null);

      const result = await requireUser();
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
    });

    it('returns 401 when the upsert throws (e.g. UNIQUE email collision)', async () => {
      mockClerkAuth.mockResolvedValueOnce({ userId: 'user_collide' } as never);
      mockOne.mockResolvedValueOnce(null);
      mockClerkCurrentUser.mockResolvedValueOnce({
        id: 'user_collide',
        primaryEmailAddress: { emailAddress: 'taken@example.com' },
        emailAddresses: [{ emailAddress: 'taken@example.com' }],
      } as never);
      mockExec.mockRejectedValueOnce(new Error('unique constraint violation'));

      const result = await requireUser();
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(401);
      // Should NOT re-SELECT after a failed upsert.
      expect(mockOne).toHaveBeenCalledOnce();
    });
  });
});
