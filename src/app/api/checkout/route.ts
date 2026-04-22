/**
 * src/app/api/checkout/route.ts
 *
 * POST /api/checkout — create a Stripe Checkout Session for Pro upgrade.
 *
 * Returns { url } — the browser should redirect to this URL.
 */

import Stripe from 'stripe';
import { requireUser } from '@/lib/auth';

export const runtime = 'nodejs';

// Lazy-init: construct on first call. Module-level `new Stripe(...)` runs
// during Next.js build's page-data collection phase, where env vars may not
// be injected yet (throws "Neither apiKey nor config.authenticator provided").
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

  if (user.tier === 'pro') {
    return Response.json({ error: 'Already on Pro plan' }, { status: 400 });
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3000';

  // Build checkout session params — reuse existing Stripe customer if we have one
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [
      {
        price: process.env.STRIPE_PRO_PRICE_ID!,
        quantity: 1,
      },
    ],
    success_url: `${origin}/account?success=true`,
    cancel_url: `${origin}/account`,
    metadata: {
      user_id: user.id,
    },
  };

  if (user.stripe_customer_id) {
    params.customer = user.stripe_customer_id;
  } else {
    params.customer_email = user.email;
  }

  const session = await stripe().checkout.sessions.create(params);

  return Response.json({ url: session.url });
}
