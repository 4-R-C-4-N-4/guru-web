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
 * Two prior attempts to override Clerk's default light theme via
 * `variables` + `elements` produced near-illegible results — Clerk's
 * baked-in CSS won the specificity war on most text colors. Switched
 * to @clerk/themes' packaged `dark` baseTheme as the foundation,
 * then overlay the guru-gold accent on every text-bearing element
 * so the surface reads as ours, not Clerk's. The packaged theme
 * handles all the long-tail elements (dividers, hints, error states,
 * verification-code inputs, etc.) we'd otherwise have to enumerate
 * by hand.
 */

import { dark } from '@clerk/themes';
import { tokens } from './tokens';

// Guru gold (#c4a35a). Reads at ~7:1 on the dark theme's card bg —
// well above WCAG AA's 4.5:1 for body text. Used as the blanket
// text color so the Clerk surface visually ties in with the rest
// of the app's accent palette.
const GURU_GOLD = tokens.text.accent;

export const clerkAppearance = {
  baseTheme: dark,
  variables: {
    colorPrimary:                 GURU_GOLD,
    colorText:                    GURU_GOLD,
    colorTextSecondary:           GURU_GOLD,
    colorInputText:               GURU_GOLD,
    colorTextOnPrimaryBackground: tokens.bg.deep,
    colorDanger:                  tokens.text.error,
    fontFamily:                   tokens.font.mono,
    borderRadius:                 '4px',
  },
  elements: {
    // Belt-and-braces: every text-bearing element gets the gold
    // override directly so Clerk's element-scoped CSS can't fall
    // back to its own theme defaults. Listing the long-tail
    // elements is verbose but defensive — the variables layer
    // alone proved unreliable across Clerk versions.
    formFieldLabel:               { color: GURU_GOLD },
    formFieldInput:               { color: GURU_GOLD },
    formFieldHintText:            { color: GURU_GOLD },
    formFieldErrorText:           { color: tokens.text.error },
    headerTitle:                  { color: GURU_GOLD },
    headerSubtitle:               { color: GURU_GOLD },
    socialButtonsBlockButtonText: { color: GURU_GOLD },
    dividerText:                  { color: GURU_GOLD },
    dividerLine:                  { background: tokens.border.subtle },
    footerActionText:             { color: GURU_GOLD },
    footerActionLink:             { color: GURU_GOLD, textDecoration: 'underline' },
    identityPreviewText:          { color: GURU_GOLD },
    identityPreviewEditButton:    { color: GURU_GOLD },
    formResendCodeLink:           { color: GURU_GOLD },
    otpCodeFieldInput:            { color: GURU_GOLD },
    profileSectionTitleText:      { color: GURU_GOLD },
    profileSectionPrimaryButton:  { color: GURU_GOLD },
    profileSectionContent:        { color: GURU_GOLD },
    accordionTriggerButton:       { color: GURU_GOLD },
    breadcrumbsItem:              { color: GURU_GOLD },
    breadcrumbsItemDivider:       { color: GURU_GOLD },
    badge:                        { color: GURU_GOLD },
    // Primary CTA stays gold-on-deep — overrides the dark baseTheme's
    // default which uses accent-background-with-white-text.
    formButtonPrimary: {
      backgroundColor: GURU_GOLD,
      color:           tokens.bg.deep,
      '&:hover':       { backgroundColor: GURU_GOLD, opacity: 0.9 },
    },
  },
};
