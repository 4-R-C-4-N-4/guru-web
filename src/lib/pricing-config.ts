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

/** Monthly USD spend target per pro user. Sets the margin floor at
 *  $15/mo gross — see BRD §3.1 for the math. Bumping requires
 *  re-eyeballing the per-day-by-model implications in BRD §3.2. */
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
 *  Heavy retrieval contexts on this corpus run ~10k input tokens;
 *  responses ~1k. BRD §3 worked the cap math against these numbers. */
export const TYPICAL_INPUT_TOKENS  = 10_000;
export const TYPICAL_OUTPUT_TOKENS = 1_000;
