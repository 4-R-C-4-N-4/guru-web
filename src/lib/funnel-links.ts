/**
 * src/lib/funnel-links.ts
 *
 * Single source of truth for the anonymous-funnel auth links (PR #140 review).
 *
 * The `?continue=1` return anchor is the one load-bearing contract of the
 * whole guest→account conversion: after Clerk signup the visitor is returned
 * to `/ask?continue=1`, where GuestConvert adopts the guest question they
 * asked before signing up. EVERY "Sign in" / "Create account" affordance a
 * guest might click — the signup wall, the `/ask` header, and the homepage
 * hero — must carry this exact redirect, or a question asked before signing in
 * is silently orphaned. Defining the hrefs once keeps them from drifting.
 *
 * Pure string constants, no node deps, so client components import it freely.
 */

/** Where Clerk returns a guest after auth so GuestConvert can finish adoption. */
export const GUEST_RETURN_TO = '/ask?continue=1';

/** Sign-up / sign-in links that carry the conversion return anchor. */
export const SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent(GUEST_RETURN_TO)}`;
export const SIGN_IN_HREF = `/sign-in?redirect_url=${encodeURIComponent(GUEST_RETURN_TO)}`;
