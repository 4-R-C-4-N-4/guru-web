/**
 * src/app/api/webhooks/stripe/route.ts
 *
 * POST /api/webhooks/stripe — Stripe subscription lifecycle webhook.
 *
 * Handles:
 *   checkout.session.completed  → user upgrades to Pro
 *   customer.subscription.deleted → subscription cancelled
 *   customer.subscription.updated → status changes (canceled, past_due, active)
 *
 * Signature verification via stripe.webhooks.constructEvent.
 */

import Stripe from 'stripe';
import { headers } from 'next/headers';
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
// Event handlers
// ---------------------------------------------------------------------------

/**
 * checkout.session.completed — user completed the Stripe checkout.
 * Promote them to Pro tier and store their Stripe customer ID.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
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

  console.log(`[stripe-webhook] user ${userId} upgraded to Pro`);
}

/**
 * customer.subscription.deleted — subscription cancelled/expired.
 * Demote to Free tier (but keep stripe_customer_id for the customer portal).
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  await exec(
    `UPDATE users
     SET tier = 'free', updated_at = now()
     WHERE stripe_customer_id = $1`,
    [customerId]
  );

  console.log(`[stripe-webhook] customer ${customerId} downgraded to Free`);
}

/**
 * customer.subscription.updated — subscription status changed.
 * Demote to Free if status is 'canceled', 'past_due', or 'unpaid'.
 * Promote back to Pro if status is 'active'.
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  const user = await one<{ id: string; tier: string }>(
    `SELECT id, tier FROM users WHERE stripe_customer_id = $1`,
    [customerId]
  );

  if (!user) {
    console.error(`[stripe-webhook] no user found for customer ${customerId}`);
    return;
  }

  if (subscription.status === 'active' && user.tier !== 'pro') {
    await exec(
      `UPDATE users SET tier = 'pro', updated_at = now() WHERE id = $1`,
      [user.id]
    );
  } else if (
    ['canceled', 'past_due', 'unpaid'].includes(subscription.status) &&
    user.tier !== 'free'
  ) {
    await exec(
      `UPDATE users SET tier = 'free', updated_at = now() WHERE id = $1`,
      [user.id]
    );
  }
}
