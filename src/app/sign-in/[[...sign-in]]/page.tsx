import { SignIn } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';

// Appearance for the Clerk card is set globally on ClerkProvider in
// src/app/layout.tsx (todo:a2d75806). Page just centres the widget
// against the app's deep background.
export default function SignInPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: tokens.bg.deep,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SignIn signUpUrl="/sign-up" forceRedirectUrl="/chat" />
    </div>
  );
}
