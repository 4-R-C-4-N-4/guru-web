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
// Import handler after mocks are in place
// ---------------------------------------------------------------------------
const { POST } = await import('@/app/api/webhooks/clerk/route');

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
