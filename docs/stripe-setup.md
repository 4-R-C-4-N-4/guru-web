# Stripe Setup Guide

## Steps to complete before billing flow works

### 1. Create a Stripe account and product
- Go to https://dashboard.stripe.com and sign in (or create an account)
- Navigate to **Products → + Add product**
  - Name: `Guru Pro`
  - Description: `Unlimited queries, premium model, citation export, priority retrieval`
  - Pricing model: `Recurring`
  - Price: `$12.00 USD / month`
- Save the product — copy the **Price ID** (starts with `price_`)

### 2. Copy keys into .env.local
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...      # set after step 3
STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 3. Set up the Stripe webhook (for subscription events)
- In Stripe dashboard → **Developers → Webhooks → + Add endpoint**
- URL: `https://your-domain.com/api/webhooks/stripe` (use `stripe listen` for local dev)
- Events to subscribe:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Copy the **Signing secret** → set as `STRIPE_WEBHOOK_SECRET` in `.env.local`

### 4. Local testing with Stripe CLI
```bash
# Install Stripe CLI (if not already)
brew install stripe/stripe-cli/stripe  # macOS
# or download from https://stripe.com/docs/stripe-cli

# Login
stripe login

# Forward webhooks to local dev server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# The CLI prints a webhook signing secret (whsec_...) — use this as
# STRIPE_WEBHOOK_SECRET in .env.local for local dev

# Trigger a test checkout
stripe trigger checkout.session.completed
```

### 5. Configure customer portal (optional but recommended)
- Stripe dashboard → Settings → Billing → Customer portal
- Enable: manage subscriptions, view invoices, update payment method
- This gives users a self-service billing page managed by Stripe

## How it works

1. User clicks "Upgrade" on the account page
2. `POST /api/checkout` creates a Stripe Checkout Session with:
   - `mode: 'subscription'`
   - `price: STRIPE_PRO_PRICE_ID`
   - `success_url: /account?success=true`
   - `cancel_url: /account`
   - `customer_email` and `metadata` (user ID)
3. Browser redirects to Stripe's hosted checkout page
4. On success, Stripe sends `checkout.session.completed` webhook
5. `/api/webhooks/stripe` updates the user's `tier` to `'pro'` in the DB
6. All future queries use the pro model and pro quota (500/day)

## Stripe v22 notes
- `stripe` npm package v22 uses the default export: `import Stripe from 'stripe'`
- Webhook signature verification: `stripe.webhooks.constructEvent(body, sig, secret)`
- Types are generated automatically — use `Stripe.Checkout.Session`, etc.
