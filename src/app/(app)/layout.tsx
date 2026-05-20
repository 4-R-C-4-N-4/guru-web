'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';
import NavBar from '@/components/nav-bar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();

  // Bounce signed-out users to /sign-in from an effect, not during
  // render — calling router.replace() inline triggers React's "Cannot
  // update a component while rendering a different component" warning
  // under React 19 / Next 16. Same bug class as todo:08fd0a9a.
  useEffect(() => {
    if (isLoaded && !isSignedIn) router.replace('/sign-in');
  }, [isLoaded, isSignedIn, router]);

  if (isLoaded && !isSignedIn) return null;

  return (
    <div style={{ background: tokens.bg.deep, minHeight: '100vh', color: tokens.text.primary }}>
      <NavBar />
      {children}
    </div>
  );
}
