'use client';

import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';
import NavBar from '@/components/nav-bar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();

  if (isLoaded && !isSignedIn) {
    router.replace('/sign-in');
    return null;
  }

  return (
    <div style={{ background: tokens.bg.deep, minHeight: '100vh', color: tokens.text.primary }}>
      <NavBar />
      {children}
    </div>
  );
}
