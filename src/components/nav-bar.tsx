'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
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
  const { signOut } = useClerk();
  const pathname = usePathname();
  const router   = useRouter();
  const mobile   = useIsMobile();
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [tier,       setTier]       = useState<string>('free');
  const avatarRef = useRef<HTMLDivElement>(null);

  // Close the desktop avatar dropdown on click-outside / Escape.
  useEffect(() => {
    if (!avatarOpen) return;
    const onClick = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAvatarOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [avatarOpen]);

  const handleSignOut = async () => {
    setAvatarOpen(false);
    setMenuOpen(false);
    await signOut(() => router.push('/'));
  };

  // Tier comes from /api/quota, not Clerk's publicMetadata — the Stripe
  // webhook updates Postgres users.tier and nothing mirrors that into
  // Clerk (todo:c19a7b6b). Reading from publicMetadata always showed
  // 'free' for upgraded users.
  useEffect(() => {
    fetch('/api/quota')
      .then(r => r.json())
      .then((d: { tier?: string }) => { if (d.tier) setTier(d.tier); })
      .catch(() => {});
  }, []);

  const initials = [user?.firstName, user?.lastName].filter(Boolean).map(n => n![0]).join('') || '?';

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
          <div ref={avatarRef} style={{ position: 'relative' }}>
            <button
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={avatarOpen}
              onClick={() => setAvatarOpen(o => !o)}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: `linear-gradient(135deg, ${tokens.tradition.hermeticism}, ${tokens.tradition.gnosticism})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontFamily: tokens.font.mono, color: tokens.bg.deep, fontWeight: 700,
                border: 'none', padding: 0, cursor: 'pointer',
              }}
            >{initials}</button>

            {avatarOpen && (
              <div role="menu" style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                minWidth: 160,
                background: tokens.bg.surface,
                border: `1px solid ${tokens.border.subtle}`,
                borderRadius: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                zIndex: 101,
                overflow: 'hidden',
              }}>
                <button role="menuitem" onClick={() => { setAvatarOpen(false); router.push('/account'); }} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 14px', background: 'none', border: 'none',
                  borderBottom: `1px solid ${tokens.border.subtle}`,
                  color: tokens.text.secondary,
                  fontFamily: tokens.font.mono, fontSize: 11, cursor: 'pointer', letterSpacing: 1,
                }}>Account</button>
                <button role="menuitem" onClick={handleSignOut} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 14px', background: 'none', border: 'none',
                  color: tokens.text.secondary,
                  fontFamily: tokens.font.mono, fontSize: 11, cursor: 'pointer', letterSpacing: 1,
                }}>Sign out</button>
              </div>
            )}
          </div>
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
          <button onClick={handleSignOut} style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '14px 20px', background: 'none', border: 'none',
            color: tokens.text.secondary,
            fontFamily: tokens.font.mono, fontSize: 13, cursor: 'pointer', letterSpacing: 1,
          }}>Sign out</button>
        </div>
      )}
    </nav>
  );
}
