'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';

const NAV_ITEMS = [
  { href: '/chat',     label: 'Query'    },
  { href: '/history',  label: 'Sessions' },
  { href: '/settings', label: 'Scope'    },
  { href: '/account',  label: 'Account'  },
];

export default function NavBar() {
  const { user } = useUser();
  const pathname = usePathname();
  const router   = useRouter();
  const mobile   = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const tier      = (user?.publicMetadata?.tier as string) ?? 'free';
  const initials  = [user?.firstName, user?.lastName].filter(Boolean).map(n => n![0]).join('') || '?';

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: mobile ? '10px 16px' : '12px 24px',
      borderBottom: `1px solid ${tokens.border.subtle}`,
      background: tokens.bg.surface,
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      {/* Logo + desktop nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 10 : 20 }}>
        <button onClick={() => router.push('/chat')} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontFamily: tokens.font.display, fontSize: mobile ? 18 : 22, fontWeight: 600, color: tokens.text.accent, letterSpacing: 3 }}>GURU</span>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, border: `1px solid ${tokens.border.subtle}`, padding: '2px 5px', borderRadius: 2 }}>v2</span>
        </button>

        {!mobile && (
          <div style={{ display: 'flex', gap: 4 }}>
            {NAV_ITEMS.map(item => {
              const active = pathname?.startsWith(item.href);
              return (
                <button key={item.href} onClick={() => router.push(item.href)} style={{
                  background: active ? tokens.bg.raised : 'none',
                  border: active ? `1px solid ${tokens.border.subtle}` : '1px solid transparent',
                  color: active ? tokens.text.primary : tokens.text.secondary,
                  fontFamily: tokens.font.mono, fontSize: 11,
                  padding: '6px 12px', borderRadius: 3, cursor: 'pointer',
                }}>{item.label}</button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right side: tier badge + avatar / hamburger */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted,
          padding: '3px 7px',
          background: tier === 'pro' ? `${tokens.text.accent}15` : tokens.bg.raised,
          border: `1px solid ${tier === 'pro' ? tokens.border.accent : tokens.border.subtle}`,
          borderRadius: 2, textTransform: 'uppercase', letterSpacing: 1,
        }}>{tier}</span>

        {mobile ? (
          <button onClick={() => setMenuOpen(o => !o)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: tokens.text.secondary, fontSize: 20, padding: '4px 2px',
            lineHeight: 1, fontFamily: tokens.font.mono,
          }}>{menuOpen ? '✕' : '≡'}</button>
        ) : (
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: `linear-gradient(135deg, ${tokens.tradition.hermeticism}, ${tokens.tradition.gnosticism})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontFamily: tokens.font.mono, color: tokens.bg.deep, fontWeight: 700,
          }}>{initials}</div>
        )}
      </div>

      {/* Mobile dropdown */}
      {mobile && menuOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: tokens.bg.surface,
          borderBottom: `1px solid ${tokens.border.subtle}`, zIndex: 99,
        }}>
          {NAV_ITEMS.map(item => {
            const active = pathname?.startsWith(item.href);
            return (
              <button key={item.href} onClick={() => { router.push(item.href); setMenuOpen(false); }} style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '14px 20px', background: active ? tokens.bg.raised : 'none',
                border: 'none', borderBottom: `1px solid ${tokens.border.subtle}`,
                color: active ? tokens.text.accent : tokens.text.secondary,
                fontFamily: tokens.font.mono, fontSize: 13, cursor: 'pointer', letterSpacing: 1,
              }}>{item.label}</button>
            );
          })}
        </div>
      )}
    </nav>
  );
}
