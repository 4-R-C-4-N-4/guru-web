-- migrations/011_user_payment_state.sql
--
-- Adds users.payment_state for tracking Stripe billing-health flags
-- independent of tier (todo:33d44563).
--
-- Stripe smart retries reattempt a failed invoice for 1-3 weeks before
-- the subscription transitions to canceled/unpaid. During that window
-- the customer has paid for the current period but their renewal is
-- in jeopardy — they need to update their card. Demoting them to free
-- the moment status flips to 'past_due' (the previous behavior) cut
-- service for users Stripe was still trying to charge. Tracking
-- payment_state lets us keep them on Pro while surfacing a "your card
-- is failing" banner.
--
-- Values:
--   NULL          → billing healthy or not applicable (free user)
--   'past_due'    → most recent invoice failed; Stripe is retrying
--
-- Cleared on:
--   - invoice.payment_succeeded
--   - customer.subscription.updated → status='active'
--   - customer.subscription.deleted (regardless of cause)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payment_state TEXT NULL
    CHECK (payment_state IS NULL OR payment_state IN ('past_due'));
