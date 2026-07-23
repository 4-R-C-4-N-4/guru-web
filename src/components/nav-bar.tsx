'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { IconMenu, IconClose } from '@/components/icons';

// Desktop bar is slim (todo:063efee7): Account lives in the avatar menu,
// not the bar — five items with a duplicate read as unconsidered. "Ask"
// matches the send button's verb (was "Query"; nav and button naming the
// same action differently is exactly the cohesion break we're removing).
const NAV_ITEMS = [
  { href: '/chat',     label: 'Ask'      },
  { href: '/history',  label: 'Sessions' },
  { href: '/settings', label: 'Scope'    },
  { href: '/read',     label: 'Library'  },
  { href: '/blog',     label: 'Essays'   },
];

// Mobile has no avatar menu, so Account rides the hamburger dropdown —
// dropping it entirely would leave URL-typing as the only mobile path
// (todo:bddd1603 pinned that invariant when Account lived in NAV_ITEMS).
const MOBILE_MENU_ITEMS = [
  ...NAV_ITEMS,
  { href: '/account', label: 'Account' },
];

export default function NavBar() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const pathname = usePathname();
  const router   = useRouter();
  const mobile   = useIsMobile();
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [avatarOpen,   setAvatarOpen]   = useState(false);
  const [tier,         setTier]         = useState<string>('free');
  const [paymentState, setPaymentState] = useState<string | null>(null);
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
    // redirectUrl form: Clerk invalidates the session then triggers a full
    // window.location redirect at the end. The callback form raced with
    // session invalidation — router.push fired while the cookie was still
    // mid-flight and the dropdown just closed without actually signing
    // out (todo:f4d5b560).
    await signOut({ redirectUrl: '/' });
  };

  // Tier comes from /api/quota, not Clerk's publicMetadata — the Stripe
  // webhook updates Postgres users.tier and nothing mirrors that into
  // Clerk (todo:c19a7b6b). Reading from publicMetadata always showed
  // 'free' for upgraded users. payment_state piggybacks the same
  // request to drive the past-due banner (todo:33d44563).
  useEffect(() => {
    fetch('/api/quota')
      .then(r => r.json())
      .then((d: { tier?: string; payment_state?: string | null }) => {
        if (d.tier) setTier(d.tier);
        setPaymentState(d.payment_state ?? null);
      })
      .catch(() => {});
  }, []);

  // Avatar label cascade (todo:11310d03). Email-only / social signups
  // commonly have no firstName/lastName; falling back to '?' looked broken.
  // Order: first+last initials → first letter of primary email → null
  // (caller renders a person glyph SVG instead of any character).
  const nameInitials = [user?.firstName, user?.lastName].filter(Boolean).map(n => n![0]!.toUpperCase()).join('');
  const emailLetter  = user?.primaryEmailAddress?.emailAddress?.[0]?.toUpperCase() ?? null;
  const avatarLabel: string | null = nameInitials || emailLetter;

  return (
    <>
      {/* Past-due payment banner (todo:33d44563). Renders above the
          nav on every authenticated page when Stripe has flagged the
          subscription as past_due. Tier is preserved on the user's
          record so they keep Pro access during Stripe's smart-retry
          window — this banner is the call to update the card. */}
      {paymentState === 'past_due' && (
        <div
          role="alert"
          style={{
            background: tokens.bg.danger,
            borderBottom: `1px solid ${tokens.border.danger}`,
            color: tokens.text.errorSoft,
            fontFamily: tokens.font.mono,
            fontSize: 11,
            padding: mobile ? '10px 16px' : '8px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexDirection: mobile ? 'column' : 'row',
          }}
        >
          <span>
            Your last payment failed. Update your card to keep Pro access.
          </span>
          <button
            onClick={() => router.push('/account')}
            style={{
              background: 'none',
              color: tokens.text.errorSoft,
              border: `1px solid ${tokens.border.danger}`,
              padding: '4px 12px',
              fontFamily: tokens.font.mono,
              fontSize: 10,
              letterSpacing: 1,
              cursor: 'pointer',
              borderRadius: 2,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            Update payment
          </button>
        </div>
      )}
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: mobile ? '10px 16px' : '12px 24px',
      borderBottom: `1px solid ${tokens.border.subtle}`,
      background: tokens.bg.surface,
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      {/* Logo + desktop nav. Baseline-aligned: the serif wordmark's optical
          baseline rides higher than the mono links when flex-centered, which
          made the row look permanently misaligned (todo:063efee7). The
          negative margin swallows the wordmark's trailing letter-space so
          the gap to the first link is the gap it appears to be. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: mobile ? 10 : 20 }}>
        <button onClick={() => router.push('/chat')} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}>
          <span style={{ fontFamily: tokens.font.display, fontSize: mobile ? 18 : 22, fontWeight: 600, color: tokens.text.accent, letterSpacing: 3, marginRight: -3, lineHeight: 1 }}>GURU</span>
        </button>

        {!mobile && (
          <div style={{ display: 'flex', gap: 4 }}>
            {NAV_ITEMS.map(item => {
              const active = pathname?.startsWith(item.href);
              return (
                <button
                  key={item.href}
                  className="nav-link"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => router.push(item.href)}
                >{item.label}</button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right side: avatar (tier rides it as a gold ring — the old 9px
          chip was the last sub-10px text in the app and belonged to
          neither the nav nor the avatar) / hamburger on mobile. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {mobile ? (
          <button
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen(o => !o)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: tokens.text.secondary, padding: 6, lineHeight: 0,
            }}
          >{menuOpen ? <IconClose size={18} /> : <IconMenu size={18} />}</button>
        ) : (
          <div ref={avatarRef} style={{ position: 'relative' }}>
            <button
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={avatarOpen}
              title={`Signed in — ${tier}`}
              onClick={() => setAvatarOpen(o => !o)}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: `linear-gradient(135deg, ${tokens.tradition.hermeticism}, ${tokens.tradition.gnosticism})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontFamily: tokens.font.mono, color: tokens.bg.deep, fontWeight: 700,
                // Pro tier reads as a gold ring; transparent for free so the
                // avatar never shifts layout when quota resolves.
                border: `2px solid ${tier === 'pro' ? tokens.text.accent : 'transparent'}`,
                padding: 0, cursor: 'pointer',
              }}
            >{avatarLabel ?? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
              </svg>
            )}</button>

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
                {/* Plan row: the tier used to be a chip in the bar; the ring
                    carries it visually, this row spells it out. */}
                <div aria-hidden style={{
                  padding: '8px 14px', borderBottom: `1px solid ${tokens.border.subtle}`,
                  fontFamily: tokens.font.mono, fontSize: 11, letterSpacing: 1,
                  color: tier === 'pro' ? tokens.text.accent : tokens.text.muted,
                }}>Plan — {tier}</div>
                <button role="menuitem" className="menu-item" onClick={() => { setAvatarOpen(false); router.push('/account'); }} style={{
                  borderBottom: `1px solid ${tokens.border.subtle}`,
                }}>Account</button>
                <button role="menuitem" className="menu-item" onClick={handleSignOut}>Sign out</button>
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
          {MOBILE_MENU_ITEMS.map(item => {
            const active = pathname?.startsWith(item.href);
            return (
              <button key={item.href} className="menu-item" onClick={() => { router.push(item.href); setMenuOpen(false); }} style={{
                padding: '14px 20px', fontSize: 13,
                background: active ? tokens.bg.raised : undefined,
                borderBottom: `1px solid ${tokens.border.subtle}`,
                color: active ? tokens.text.accent : undefined,
              }}>{item.label}{item.href === '/account' ? (
                <span style={{ float: 'right', color: tier === 'pro' ? tokens.text.accent : tokens.text.muted, fontSize: 11 }}>{tier}</span>
              ) : null}</button>
            );
          })}
          <button className="menu-item" onClick={handleSignOut} style={{ padding: '14px 20px', fontSize: 13 }}>Sign out</button>
        </div>
      )}
    </nav>
    </>
  );
}
