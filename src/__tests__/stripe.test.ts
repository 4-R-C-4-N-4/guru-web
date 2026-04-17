/**
 * src/__tests__/stripe.test.ts
 *
 * Unit tests for Stripe webhook handler.
 * Stripe, db, and next/headers are mocked.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be before any imports that use the mocked modules
// ---------------------------------------------------------------------------

const mockConstructEvent = vi.fn();

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  one:   vi.fn(),
  exec:  vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(() => ({
    get: (key: string) => (key === 'stripe-signature' ? 'sig_test_123' : null),
  })),
}));

vi.mock('stripe', () => {
  function Stripe() {
    return {
      webhooks: { constructEvent: mockConstructEvent },
      checkout:  { sessions: { create: vi.fn() } },
    };
  }
  return { default: Stripe };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as db from '@/lib/db';
import * as auth from '@/lib/auth';

const mockOne  = db.one  as MockedFunction<typeof db.one>;
const mockExec = db.exec as MockedFunction<typeof db.exec>;
const mockAuth = auth.requireUser as MockedFunction<typeof auth.requireUser>;

const { POST: stripeWebhookPOST } = await import('@/app/api/webhooks/stripe/route');
const { POST: checkoutPOST } = await import('@/app/api/checkout/route');

const PRO_USER = {
  id: 'user_1',
  email: 'test@example.com',
  tier: 'pro' as const,
  stripe_customer_id: 'cus_123',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWebhookReq(body: object): Request {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'stripe-signature': 'sig_test_123' },
  });
}

// ---------------------------------------------------------------------------
// Webhook tests
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  it('checkout.session.completed: upgrades user to Pro and stores customer_id', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { metadata: { user_id: 'user_1' }, customer: 'cus_123' } },
    });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    const body = await res.json() as { received: boolean };

    expect(res.status).toBe(200);
    expect(body.received).toBe(true);
    expect(mockExec).toHaveBeenCalledOnce();
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("tier = 'pro'");
    expect(sql).toContain('stripe_customer_id');
    expect(params).toEqual(['user_1', 'cus_123']);
  });

  it('checkout.session.completed: skips upgrade if user_id missing from metadata', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { metadata: {}, customer: 'cus_123' } },
    });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('customer.subscription.deleted: downgrades user to Free', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_123' } },
    });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("tier = 'free'");
    expect(params).toEqual(['cus_123']);
  });

  it('customer.subscription.updated (canceled): downgrades pro user', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'canceled' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro' });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("tier = 'free'");
    expect(params).toEqual(['user_1']);
  });

  it('customer.subscription.updated (active): upgrades free user', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'active' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'free' });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("tier = 'pro'");
    expect(params).toEqual(['user_1']);
  });

  it('customer.subscription.updated (active for already-pro user): no-op', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'active' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro' });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('customer.subscription.updated (past_due): downgrades user', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'past_due' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro' });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql] = mockExec.mock.calls[0];
    expect(sql).toContain("tier = 'free'");
  });

  it('unknown event type: acknowledged without error', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: { object: {} },
    });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Checkout endpoint tests
// ---------------------------------------------------------------------------

describe('POST /api/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_PRO_PRICE_ID = 'price_test_123';
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
  });

  it('returns 401 if not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await checkoutPOST();
    expect(res.status).toBe(401);
  });

  it('returns 400 if user is already Pro', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    const res = await checkoutPOST();
    const body = await res.json() as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toContain('Pro');
  });
});
