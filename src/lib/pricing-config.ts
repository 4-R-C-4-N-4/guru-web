/**
 * src/lib/pricing-config.ts
 *
 * Single source of truth for the pricing policy.  Bumping any value
 * here propagates to:
 *
 *   - `TIER_LIMITS` in src/lib/spend.ts (the cap reserveBudget reads)
 *   - `PROVIDER_DISPLAY.questionsPerDay` in src/lib/provider-display.ts
 *     (the picker copy users see)
 *   - implicitly, the picker's "~N questions per day" labels
 *
 * Spec: docs/model-selection/BRD-model-selection.md §3.1, §6.2.
 *
 * The full derivation tree:
 *
 *     PRO_MONTHLY_USD_TARGET (policy: 50% margin floor at $15/mo gross)
 *           │
 *           └─ ÷ PERIOD_DAYS  ─►  PRO_DAILY_USD_CAP
 *                                       │
 *                                       └─ ÷ per-query cost ─►  questionsPerDay
 *
 * `FALLBACK_PRICING` (src/lib/fallback-pricing.ts) supplies the
 * per-query cost via the typical-workload assumption below. Bumping
 * provider rates updates the picker labels automatically; bumping
 * the cap updates both the enforcement value and the labels.
 *
 * This module is intentionally tiny and dependency-free so it can
 * be imported from any client- or server-side file without dragging
 * in OpenAI, pg, or anything else.
 */

/** Sticker price shown to users and charged by Stripe. Single source
 *  of truth for the displayed Pro price — UI and runbooks must import
 *  this rather than hardcoding "$15/mo" so the marketing copy can't
 *  drift from the Stripe Price the user actually pays. The Stripe
 *  Price ID itself (STRIPE_PRO_PRICE_ID env) must be created at
 *  exactly this amount; verify after any change. */
export const PRO_MONTHLY_PRICE_USD = 15;

/** Monthly USD COGS target per pro user. Sets the margin floor at
 *  PRO_MONTHLY_PRICE_USD gross — see BRD §3.1 for the math. Bumping
 *  requires re-eyeballing the per-day-by-model implications in BRD §3.2. */
export const PRO_MONTHLY_USD_TARGET = 5.00;

/** Days the budget rolls over. spend.ts uses PERIOD = 'daily', so
 *  this is the divisor that turns the monthly target into the
 *  enforced daily cap. Don't change without thinking through the
 *  reset semantics in spend.ts. */
export const PERIOD_DAYS = 30;

/** Derived: per-day USD cap enforced by reserveBudget. */
export const PRO_DAILY_USD_CAP = PRO_MONTHLY_USD_TARGET / PERIOD_DAYS;

/** Daily query caps. Free's is the binding gate (no USD cap on free).
 *  Pro's is a soft secondary gate against runaway loops; the USD cap
 *  is the primary economic gate. BRD §6.2. */
export const FREE_DAILY_QUERY_LIMIT = 10;
export const PRO_DAILY_QUERY_LIMIT  = 100;

/** Typical Guru workload — used by provider-display.ts to estimate
 *  per-query cost for the picker's "~N questions per day" labels.
 *
 *  Calibration sources (only real data we have pre-launch — see
 *  operator session e4f9d4f7):
 *    deepseek/deepseek-chat   ~5,200 in / 1,200 out
 *    anthropic/claude-sonnet-4.5  ~12,400 in / 2,000-2,600 out
 *
 *  We have ZERO data on the curated picker models themselves
 *  (deepseek-v4-pro, grok-4.3, sonnet-4.6, gpt-5.4). The 10k/2k
 *  pair is a conservative middle ground that covers DeepSeek's
 *  terse 1.2k case and Sonnet 4.5's 2-2.6k case with headroom.
 *
 *  Recalibrate post-launch from real queries data — admin
 *  telemetry script TBD. */
export const TYPICAL_INPUT_TOKENS  = 10_000;
export const TYPICAL_OUTPUT_TOKENS = 2_000;
