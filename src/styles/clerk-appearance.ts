/**
 * src/styles/clerk-appearance.ts
 *
 * Shared appearance config for Clerk's hosted components (SignIn,
 * SignUp, UserProfile, UserButton). Passed once at the
 * ClerkProvider boundary so every Clerk surface — the dedicated
 * /sign-in, /sign-up pages and the in-app openUserProfile() modal —
 * inherits the dark theme without each call site having to repeat
 * the appearance object (todo:a2d75806).
 *
 * Variables map onto Clerk's CSS-variable theming layer:
 *   https://clerk.com/docs/customization/variables
 *
 * Values are sourced from tokens.ts so the Clerk surface stays in
 * lock-step with the rest of the app's palette.
 */

import { tokens } from './tokens';

// Untyped: @clerk/types is not in our dep tree (we only have
// @clerk/nextjs at top level), so let TypeScript infer the shape
// from the literal. ClerkProvider validates it at the call site.
// Contrast notes: the rest of the app uses tokens.text.secondary
// (#8a8578) for de-emphasised body text, but it always sits next to
// high-contrast primary text or visual context that lifts it. Clerk
// uses colorTextSecondary for nearly *all* labels, dividers, and
// helper copy in isolation, where #8a8578 just looks washed out.
// Keep colorText and colorTextSecondary both at primary; reserve the
// muted token for the explicitly-de-emphasised footer link variant.
//
// Card sits on the page bg (tokens.bg.deep). Use bg.raised for the
// card so it visibly lifts off the page; bg.overlay for inputs so
// they stand out within the card. Earlier values (surface for card,
// raised for inputs) gave near-zero elevation cues in dark mode.
export const clerkAppearance = {
  variables: {
    colorBackground:      tokens.bg.raised,
    colorPrimary:         tokens.text.accent,
    colorText:            tokens.text.primary,
    colorTextSecondary:   tokens.text.primary,
    colorInputBackground: tokens.bg.overlay,
    colorInputText:       tokens.text.primary,
    colorNeutral:         tokens.text.primary,
    colorDanger:          tokens.text.error,
    fontFamily:           tokens.font.mono,
    borderRadius:         '4px',
  },
  elements: {
    card: {
      backgroundColor: tokens.bg.raised,
      border:          `1px solid ${tokens.border.medium}`,
      boxShadow:       'none',
    },
    // The OAuth/social-button row defaults to a near-white pill that
    // visually breaks against the dark card. Slightly elevated bg +
    // a more visible border so the buttons read as buttons.
    socialButtonsBlockButton: {
      backgroundColor: tokens.bg.overlay,
      borderColor:     tokens.border.medium,
      color:           tokens.text.primary,
    },
    formButtonPrimary: {
      backgroundColor: tokens.text.accent,
      color:           tokens.bg.deep,
      '&:hover': { backgroundColor: tokens.text.accent, opacity: 0.9 },
    },
    footer: {
      backgroundColor: tokens.bg.raised,
    },
    // Labels above input fields — Clerk's default uses
    // colorTextSecondary, which we just bumped, but the hover-help
    // text (e.g. "Forgot password?") needs a slight lift too.
    formFieldLabel: {
      color: tokens.text.primary,
    },
    formFieldHintText: {
      color: tokens.text.secondary,
    },
    // The "Don't have an account? Sign up" line at the bottom of
    // SignIn — keep this slightly muted (it's secondary CTA) but
    // not so muted it disappears.
    footerActionText: {
      color: tokens.text.secondary,
    },
    footerActionLink: {
      color: tokens.text.link,
    },
  },
};
