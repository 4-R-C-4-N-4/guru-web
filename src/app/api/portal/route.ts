/**
 * src/app/api/portal/route.ts
 *
 * POST /api/portal — create a Stripe Customer Portal session.
 *
 * The portal is Stripe's hosted UI for managing an active subscription:
 * cancel, switch payment method, view invoices, swap plan. We don't need
 * any of that logic in-app — when a user cancels in the portal, Stripe
 * fires customer.subscription.deleted/updated and the existing webhook
 * (src/app/api/webhooks/stripe/route.ts) flips users.tier back to 'free'.
 *
 * Returns { url } — the browser redirects to this URL.
 *
 * Eligibility:
 *   - Authenticated (requireUser)
 *   - Has stripe_customer_id (otherwise there's nothing to manage —
 *     free users with no prior checkout don't have a Stripe customer).
 */

import Stripe from 'stripe';
import { requireUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Lazy-init: see checkout/route.ts for why module-level construction
// breaks Next.js's build-time page-data collection.
let _stripe: Stripe | null = null;
function stripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true });
  }
  return _stripe;
}

export async function POST() {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const rl = await rateLimit(user.id, 'portal', 60);
  if (!rl.allowed) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  if (!user.stripe_customer_id) {
    return Response.json(
      { error: 'No Stripe customer for this user' },
      { status: 400 },
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3000';

  const session = await stripe().billingPortal.sessions.create({
    customer:   user.stripe_customer_id,
    return_url: `${origin}/account`,
  });

  return Response.json({ url: session.url });
}
