/**
 * src/app/blog/layout.tsx
 *
 * Shared chrome for the public blog (todo:3eb7c659). The blog routes were
 * fully isolated — a reader who landed on an essay had no way back into the
 * app. This persistent top bar renders an auth-aware home button on every
 * blog route (index + post). Server component; the button itself is the only
 * client island.
 */

import type { ReactNode } from 'react';
import BlogHomeButton from '@/components/blog-home-button';
import { tokens } from '@/styles/tokens';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tokens.bg.deep, minHeight: '100vh' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 24px',
          borderBottom: `1px solid ${tokens.border.subtle}`,
          background: tokens.bg.surface,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <BlogHomeButton />
      </div>
      {children}
    </div>
  );
}
