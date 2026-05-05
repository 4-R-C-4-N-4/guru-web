/**
 * src/app/api/webhooks/stripe/route.ts
 *
 * POST /api/webhooks/stripe — Stripe subscription lifecycle webhook.
 *
 * Handles:
 *   checkout.session.completed     → user upgrades to Pro
 *   customer.subscription.deleted  → subscription cancelled
 *   customer.subscription.updated  → status changes (active, past_due,
 *                                    canceled, unpaid)
 *   invoice.payment_failed         → mark payment_state='past_due'
 *                                    (KEEP tier — Stripe is retrying)
 *   invoice.payment_succeeded      → clear payment_state
 *
 * Signature verification via stripe.webhooks.constructEvent.
 *
 * Tier source of truth is Postgres users.tier. After every tier
 * update we mirror the new value into Clerk's user.publicMetadata.tier
 * as a cache — Clerk-session-driven UI can read tier from the JWT
 * without an extra /api/quota fetch. Clerk failures are logged and
 * swallowed so the webhook still 200s and Postgres remains canonical.
 *
 * Past-due handling (todo:33d44563): subscription.status='past_due'
 * means the latest invoice failed and Stripe is retrying — typically
 * over a 1-3 week smart-retry window. The user has paid for the
 * current period; demoting them to free immediately would cut service
 * before Stripe gives up. Instead we set payment_state='past_due',
 * keep tier='pro', and let the UI surface a banner. The terminal
 * statuses ('canceled', 'unpaid') still demote.
 */

import Stripe from 'stripe';
import { headers } from 'next/headers';
import { clerkClient } from '@clerk/nextjs/server';
import { exec, one } from '@/lib/db';

export const dynamic  = 'force-dynamic';
export const runtime  = 'nodejs';

// Lazy-init: see explanation in /api/checkout/route.ts.
let _stripe: Stripe | null = null;
function stripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true });
  }
  return _stripe;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const body   = await req.text();
  const sig    = (await headers()).get('stripe-signature') ?? '';
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set');
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err);
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      default:
        // Unhandled event — acknowledge so Stripe doesn't retry
        break;
    }
  } catch (err) {
    console.error(`[stripe-webhook] ${event.type} failed:`, err);
    // Return 500 so Stripe retries
    return Response.json({ error: 'Handler error' }, { status: 500 });
  }

  return Response.json({ received: true });
}

// ---------------------------------------------------------------------------
// Clerk metadata mirror — cache of users.tier for SSR / session-token reads
// ---------------------------------------------------------------------------

async function mirrorTierToClerk(userId: string, tier: 'free' | 'pro'): Promise<void> {
  try {
    const clerk = await clerkClient();
    await clerk.users.updateUserMetadata(userId, { publicMetadata: { tier } });
  } catch (err) {
    // Postgres is canonical; a Clerk mirror failure must not 500 the
    // webhook (Stripe would retry indefinitely). Log and continue.
    console.error(`[stripe-webhook] clerk mirror failed for ${userId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * checkout.session.completed — user completed the Stripe checkout.
 * Promote them to Pro tier and store their Stripe customer ID.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // Guard: only treat the checkout as a completed sale if Stripe says it's paid.
  // checkout.session.completed can fire for unpaid sessions in async-payment flows.
  if (session.payment_status !== 'paid') {
    console.log(
      `[stripe-webhook] checkout.session.completed ignored — payment_status=${session.payment_status}`
    );
    return;
  }

  const userId = session.metadata?.user_id;
  if (!userId) {
    console.error('[stripe-webhook] checkout.session.completed missing user_id metadata');
    return;
  }

  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;

  await exec(
    `UPDATE users
     SET tier = 'pro', stripe_customer_id = $2, updated_at = now()
     WHERE id = $1`,
    [userId, customerId ?? null]
  );

  await mirrorTierToClerk(userId, 'pro');

  console.log(`[stripe-webhook] user ${userId} upgraded to Pro`);
}

/**
 * customer.subscription.deleted — subscription cancelled/expired.
 * Demote to Free, clear any payment_state warning. Keep
 * stripe_customer_id for the customer portal flow.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  // RETURNING id so we can mirror the change into Clerk metadata.
  const updated = await one<{ id: string }>(
    `UPDATE users
     SET tier = 'free', payment_state = NULL, updated_at = now()
     WHERE stripe_customer_id = $1
     RETURNING id`,
    [customerId]
  );

  if (updated) {
    await mirrorTierToClerk(updated.id, 'free');
  }

  console.log(`[stripe-webhook] customer ${customerId} downgraded to Free`);
}

/**
 * customer.subscription.updated — subscription status changed.
 *
 *   active             → ensure tier='pro', clear payment_state
 *   past_due           → KEEP tier (Stripe retries for 1-3 weeks),
 *                        set payment_state='past_due' so UI warns
 *   canceled / unpaid  → demote to free, clear payment_state
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  const user = await one<{ id: string; tier: string; payment_state: string | null }>(
    `SELECT id, tier, payment_state FROM users WHERE stripe_customer_id = $1`,
    [customerId]
  );

  if (!user) {
    console.error(`[stripe-webhook] no user found for customer ${customerId}`);
    return;
  }

  if (subscription.status === 'active') {
    // Promote (or stay pro) and clear any prior past_due flag.
    if (user.tier !== 'pro' || user.payment_state !== null) {
      await exec(
        `UPDATE users SET tier = 'pro', payment_state = NULL, updated_at = now() WHERE id = $1`,
        [user.id]
      );
      if (user.tier !== 'pro') await mirrorTierToClerk(user.id, 'pro');
    }
  } else if (subscription.status === 'past_due') {
    // Don't demote — Stripe is still retrying. Just flag it.
    if (user.payment_state !== 'past_due') {
      await exec(
        `UPDATE users SET payment_state = 'past_due', updated_at = now() WHERE id = $1`,
        [user.id]
      );
      console.log(`[stripe-webhook] customer ${customerId} marked past_due (tier preserved)`);
    }
  } else if (['canceled', 'unpaid'].includes(subscription.status)) {
    if (user.tier !== 'free' || user.payment_state !== null) {
      await exec(
        `UPDATE users SET tier = 'free', payment_state = NULL, updated_at = now() WHERE id = $1`,
        [user.id]
      );
      if (user.tier !== 'free') await mirrorTierToClerk(user.id, 'free');
    }
  }
}

/**
 * invoice.payment_failed — fires when Stripe attempts to charge an
 * invoice and the payment method declines. Set payment_state but
 * preserve tier; the user still has access for the current period and
 * Stripe will retry. This event is finer-grained than
 * subscription.updated → past_due (it fires per-attempt) and gives
 * the operator earlier signal in logs.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) return;

  // RETURNING id so we can distinguish "marked past_due" from
  // "no user matched" — same logging shape as handleSubscriptionUpdated.
  // Operator-debugging: a wrong-environment customer event silently
  // updating zero rows is otherwise indistinguishable from the
  // already-flagged no-op.
  const updated = await one<{ id: string }>(
    `UPDATE users SET payment_state = 'past_due', updated_at = now()
     WHERE stripe_customer_id = $1 AND payment_state IS DISTINCT FROM 'past_due'
     RETURNING id`,
    [customerId]
  );

  if (updated) {
    console.log(`[stripe-webhook] invoice payment failed for customer ${customerId}`);
  } else {
    // Either already past_due (no-op) or no user with this customer id.
    // Distinguish the two by re-querying — kept lightweight since this
    // path runs at most once per failed invoice.
    const existing = await one<{ id: string }>(
      `SELECT id FROM users WHERE stripe_customer_id = $1`,
      [customerId]
    );
    if (!existing) {
      console.error(`[stripe-webhook] invoice.payment_failed: no user found for customer ${customerId}`);
    }
  }
}

/**
 * invoice.payment_succeeded — clears payment_state. Fires both for
 * the initial invoice (where payment_state was already null) and on
 * a successful retry after a failed attempt; the WHERE clause makes
 * the no-op case cheap.
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) return;

  // Same RETURNING shape as the failed handler so operator logs are
  // symmetric. The expected case here is a no-op (payment_state was
  // already null); we only log when the clear actually happened.
  const cleared = await one<{ id: string }>(
    `UPDATE users SET payment_state = NULL, updated_at = now()
     WHERE stripe_customer_id = $1 AND payment_state IS NOT NULL
     RETURNING id`,
    [customerId]
  );

  if (cleared) {
    console.log(`[stripe-webhook] invoice payment succeeded after retry for customer ${customerId}`);
  }
}
