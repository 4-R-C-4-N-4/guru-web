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
export const clerkAppearance = {
  variables: {
    colorBackground:      tokens.bg.surface,
    colorPrimary:         tokens.text.accent,
    colorText:            tokens.text.primary,
    colorTextSecondary:   tokens.text.secondary,
    colorInputBackground: tokens.bg.raised,
    colorInputText:       tokens.text.primary,
    colorNeutral:         tokens.text.secondary,
    colorDanger:          tokens.text.error,
    fontFamily:           tokens.font.mono,
    borderRadius:         '4px',
  },
  elements: {
    // Card sits on the page bg; remove the default light-mode shadow
    // that fights the dark surface.
    card: {
      backgroundColor: tokens.bg.surface,
      border:          `1px solid ${tokens.border.subtle}`,
      boxShadow:       'none',
    },
    // The OAuth/social-button row defaults to a near-white pill that
    // visually breaks against the dark card.
    socialButtonsBlockButton: {
      backgroundColor: tokens.bg.raised,
      borderColor:     tokens.border.subtle,
      color:           tokens.text.primary,
    },
    formButtonPrimary: {
      backgroundColor: tokens.text.accent,
      color:           tokens.bg.deep,
      '&:hover': { backgroundColor: tokens.text.accent, opacity: 0.9 },
    },
    footer: {
      backgroundColor: tokens.bg.surface,
    },
  },
};
