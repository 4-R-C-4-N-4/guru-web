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

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(),
}));

const mockUpdateUserMetadata = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn(async () => ({
    users: { updateUserMetadata: mockUpdateUserMetadata },
  })),
}));

const mockBillingPortalCreate = vi.fn();
vi.mock('stripe', () => {
  function Stripe() {
    return {
      webhooks: { constructEvent: mockConstructEvent },
      checkout:  { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: mockBillingPortalCreate } },
    };
  }
  return { default: Stripe };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as db from '@/lib/db';
import * as auth from '@/lib/auth';
import * as rl from '@/lib/rate-limit';

const mockOne  = db.one  as MockedFunction<typeof db.one>;
const mockExec = db.exec as MockedFunction<typeof db.exec>;
const mockAuth = auth.requireUser as MockedFunction<typeof auth.requireUser>;
const mockRateLimit = rl.rateLimit as MockedFunction<typeof rl.rateLimit>;

const { POST: stripeWebhookPOST } = await import('@/app/api/webhooks/stripe/route');
const { POST: checkoutPOST } = await import('@/app/api/checkout/route');
const { POST: portalPOST } = await import('@/app/api/portal/route');

const PRO_USER = {
  id: 'user_1',
  email: 'test@example.com',
  tier: 'pro' as const,
  stripe_customer_id: 'cus_123',
  payment_state: null,
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
      data: { object: { metadata: { user_id: 'user_1' }, customer: 'cus_123', payment_status: 'paid' } },
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

    // Mirror into Clerk publicMetadata (todo:aee10dd6)
    expect(mockUpdateUserMetadata).toHaveBeenCalledOnce();
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: { tier: 'pro' } });
  });

  it('checkout.session.completed: skips upgrade if user_id missing from metadata', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { metadata: {}, customer: 'cus_123', payment_status: 'paid' } },
    });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('checkout.session.completed: ignores session when payment_status is not paid', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { metadata: { user_id: 'user_1' }, customer: 'cus_123', payment_status: 'unpaid' } },
    });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    // No DB write — guard should fire before we touch users.
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('customer.subscription.deleted: downgrades user to Free and mirrors to Clerk', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_123' } },
    });
    // Handler uses one() with RETURNING id so it can mirror into Clerk.
    mockOne.mockResolvedValueOnce({ id: 'user_1' });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockOne.mock.calls[0];
    expect(sql).toContain("tier = 'free'");
    expect(sql).toContain('RETURNING id');
    expect(params).toEqual(['cus_123']);

    expect(mockUpdateUserMetadata).toHaveBeenCalledOnce();
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: { tier: 'free' } });
  });

  it('customer.subscription.deleted: no Clerk mirror if no user matched the customer id', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_unknown' } },
    });
    mockOne.mockResolvedValueOnce(null);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it('customer.subscription.updated (canceled): downgrades pro user + Clerk mirror', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'canceled' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro', payment_state: null });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("tier = 'free'");
    expect(params).toEqual(['user_1']);
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: { tier: 'free' } });
  });

  it('customer.subscription.updated (active): upgrades free user + Clerk mirror', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'active' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'free', payment_state: null });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("tier = 'pro'");
    expect(params).toEqual(['user_1']);
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: { tier: 'pro' } });
  });

  it('customer.subscription.updated (active for already-pro user): no-op, no Clerk mirror', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'active' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro', payment_state: null });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it('customer.subscription.updated (past_due): KEEPS tier, sets payment_state (todo:33d44563)', async () => {
    // past_due means Stripe is still retrying — user paid for the
    // current period and shouldn't lose access mid-retry. Demoting on
    // past_due was the previous behavior; the fix preserves tier and
    // raises a banner via payment_state instead.
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'past_due' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro', payment_state: null });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockExec.mock.calls[0];
    expect(sql).toContain("payment_state = 'past_due'");
    expect(sql).not.toContain("tier = 'free'");
    expect(params).toEqual(['user_1']);
    // No tier change → no Clerk mirror.
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it('customer.subscription.updated (past_due): no-op when already flagged past_due', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'past_due' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro', payment_state: 'past_due' });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('customer.subscription.updated (active after past_due): clears payment_state (todo:33d44563)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'active' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro', payment_state: 'past_due' });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql] = mockExec.mock.calls[0];
    expect(sql).toContain('payment_state = NULL');
    expect(sql).toContain("tier = 'pro'");
  });

  it('customer.subscription.updated (unpaid): demotes to free + clears payment_state (todo:33d44563)', async () => {
    // unpaid is the terminal failure state Stripe transitions to after
    // smart retries are exhausted; past_due → unpaid is when we
    // actually cut access.
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'unpaid' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1', tier: 'pro', payment_state: 'past_due' });
    mockExec.mockResolvedValueOnce(undefined);

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql] = mockExec.mock.calls[0];
    expect(sql).toContain("tier = 'free'");
    expect(sql).toContain('payment_state = NULL');
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: { tier: 'free' } });
  });

  it('invoice.payment_failed: marks payment_state past_due (todo:33d44563)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_123' } },
    });
    // RETURNING id — the row was updated.
    mockOne.mockResolvedValueOnce({ id: 'user_1' });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockOne.mock.calls[0];
    expect(sql).toContain("payment_state = 'past_due'");
    expect(sql).toContain('IS DISTINCT FROM');
    expect(sql).toContain('RETURNING id');
    expect(params).toEqual(['cus_123']);
  });

  it('invoice.payment_failed: error-logs unknown customer (todo:33d44563 review)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_unknown' } },
    });
    // First UPDATE matches no rows; existence check also returns null.
    mockOne.mockResolvedValueOnce(null);
    mockOne.mockResolvedValueOnce(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('no user found for customer cus_unknown'),
    );
    errSpy.mockRestore();
  });

  it('invoice.payment_succeeded: clears payment_state (todo:33d44563)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_123' } },
    });
    mockOne.mockResolvedValueOnce({ id: 'user_1' });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    const [sql, params] = mockOne.mock.calls[0];
    expect(sql).toContain('payment_state = NULL');
    expect(sql).toContain('IS NOT NULL');
    expect(sql).toContain('RETURNING id');
    expect(params).toEqual(['cus_123']);
  });

  it('invoice.payment_succeeded: silent no-op when nothing to clear (todo:33d44563 review)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_123' } },
    });
    // No row matches the WHERE clause (payment_state already NULL).
    mockOne.mockResolvedValueOnce(null);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    // Successful normal-case payments shouldn't pollute ops logs.
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('unknown event type: acknowledged without error', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: { object: {} },
    });

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it('clerk mirror failure does not 500 the webhook (Postgres remains canonical)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { metadata: { user_id: 'user_1' }, customer: 'cus_123', payment_status: 'paid' } },
    });
    mockExec.mockResolvedValueOnce(undefined);
    mockUpdateUserMetadata.mockRejectedValueOnce(new Error('clerk down'));

    const res = await stripeWebhookPOST(makeWebhookReq({}));
    expect(res.status).toBe(200);   // still 200 — would 500 force Stripe to retry forever
    expect(mockExec).toHaveBeenCalledOnce();   // Postgres update still ran
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
    // Default: rate-limit allows. Tests that exercise the 429 path override.
    mockRateLimit.mockResolvedValue({ allowed: true });
  });

  it('returns 401 if not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await checkoutPOST();
    expect(res.status).toBe(401);
  });

  it('returns 429 with Retry-After when within the per-user cooldown', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'user_1', email: 'a@b.com', tier: 'free', stripe_customer_id: null, payment_state: null });
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 240 });

    const res = await checkoutPOST();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('240');
  });

  it('returns 400 if user is already Pro', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    const res = await checkoutPOST();
    const body = await res.json() as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toContain('Pro');
  });
});

// ---------------------------------------------------------------------------
// Customer Portal endpoint tests (todo:7854e1ba)
// ---------------------------------------------------------------------------

describe('POST /api/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
    mockRateLimit.mockResolvedValue({ allowed: true });
  });

  it('returns 401 if not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await portalPOST();
    expect(res.status).toBe(401);
    expect(mockBillingPortalCreate).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After when within the per-user cooldown', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });

    const res = await portalPOST();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(mockBillingPortalCreate).not.toHaveBeenCalled();
  });

  it('returns 400 if the user has no stripe_customer_id', async () => {
    mockAuth.mockResolvedValueOnce({ id: 'user_1', email: 'a@b.com', tier: 'free', stripe_customer_id: null, payment_state: null });

    const res = await portalPOST();
    const body = await res.json() as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Stripe customer/i);
    expect(mockBillingPortalCreate).not.toHaveBeenCalled();
  });

  it('creates a billing-portal session for the user customer and returns its url', async () => {
    mockAuth.mockResolvedValueOnce(PRO_USER);
    mockBillingPortalCreate.mockResolvedValueOnce({ url: 'https://billing.stripe.com/session/abc' });

    const res = await portalPOST();
    expect(res.status).toBe(200);

    expect(mockBillingPortalCreate).toHaveBeenCalledOnce();
    const arg = mockBillingPortalCreate.mock.calls[0][0] as { customer: string; return_url: string };
    expect(arg.customer).toBe('cus_123');
    expect(arg.return_url).toBe('https://example.com/account');

    const body = await res.json() as { url: string };
    expect(body.url).toBe('https://billing.stripe.com/session/abc');
  });
});
