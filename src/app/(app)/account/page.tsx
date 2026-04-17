'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';

interface QuotaData { used: number; limit: number; tier: string; }

const PLANS = [
  { id: 'free', name: 'Free',  price: null,    features: ['30 queries/day', 'All traditions', 'Standard model'] },
  { id: 'pro',  name: 'Pro',   price: '$12/mo', features: ['Unlimited queries', 'Premium model', 'Citation export', 'Priority retrieval'] },
];

export default function AccountPage() {
  const { user } = useUser();
  const mobile   = useIsMobile();
  const [quota,  setQuota]  = useState<QuotaData | null>(null);

  const tier = (user?.publicMetadata?.tier as string) ?? 'free';

  useEffect(() => {
    fetch('/api/quota')
      .then(r => r.json())
      .then(setQuota)
      .catch(() => {});
  }, []);

  const handleUpgrade = async () => {
    const res = await fetch('/api/checkout', { method: 'POST' });
    if (res.ok) {
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    }
  };

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: mobile ? '16px 14px' : 24 }}>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, marginBottom: 18, textTransform: 'uppercase' }}>Account</div>

      {/* Plan cards */}
      <div style={{ background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 14 : 20, marginBottom: 12 }}>
        <div style={{ fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, letterSpacing: 2, marginBottom: 12, textTransform: 'uppercase' }}>Current Plan</div>
        <div style={{ display: 'flex', gap: 10, flexDirection: mobile ? 'column' : 'row' }}>
          {PLANS.map(plan => (
            <div key={plan.id} style={{
              flex: 1, padding: mobile ? 14 : 16,
              background: tier === plan.id ? `${tokens.text.accent}08` : tokens.bg.raised,
              border: `1px solid ${tier === plan.id ? tokens.border.accent : tokens.border.subtle}`,
              borderRadius: 4,
            }}>
              <div style={{ fontFamily: tokens.font.display, fontSize: 18, color: tokens.text.primary, marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                {plan.name}
                {plan.price && <span style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.text.accent }}>{plan.price}</span>}
              </div>
              <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, lineHeight: 1.8 }}>
                {plan.features.map((f, i) => <div key={i}>{f}</div>)}
              </div>
              {tier === plan.id
                ? <div style={{ fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.accent, marginTop: 8, letterSpacing: 1 }}>CURRENT</div>
                : plan.id === 'pro' && (
                  <button onClick={handleUpgrade} style={{
                    marginTop: 10, fontFamily: tokens.font.mono, fontSize: 10,
                    padding: mobile ? '10px 14px' : '6px 14px',
                    background: tokens.text.accent, color: tokens.bg.deep,
                    border: 'none', borderRadius: 2, cursor: 'pointer', fontWeight: 600, letterSpacing: 1,
                  }}>UPGRADE</button>
                )
              }
            </div>
          ))}
        </div>
      </div>

      {/* Usage bar */}
      <div style={{ background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 14 : 20, marginBottom: 12 }}>
        <div style={{ fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>Usage Today</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.text.secondary }}>Queries</span>
          <span style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.text.primary }}>
            {quota ? `${quota.used} / ${quota.limit}` : '—'}
          </span>
        </div>
        <div style={{ height: 3, background: tokens.bg.raised, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: quota ? `${Math.min((quota.used / quota.limit) * 100, 100)}%` : '0%',
            height: '100%', background: tokens.text.accent, borderRadius: 2,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Account details */}
      <div style={{ background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, padding: mobile ? 14 : 20 }}>
        <div style={{ fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, letterSpacing: 2, marginBottom: 10, textTransform: 'uppercase' }}>Account Details</div>
        {[
          { label: 'Email',        value: user?.primaryEmailAddress?.emailAddress ?? '—' },
          { label: 'Member since', value: memberSince },
          { label: 'Tier',         value: tier },
        ].map(row => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: mobile ? '8px 0' : '6px 0', borderBottom: `1px solid ${tokens.border.subtle}` }}>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}>{row.label}</span>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.secondary }}>{row.value}</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexDirection: mobile ? 'column' : 'row' }}>
          <a href="https://accounts.clerk.dev/user" target="_blank" rel="noreferrer" style={{
            fontFamily: tokens.font.mono, fontSize: 10, padding: mobile ? '12px 14px' : '6px 14px',
            background: 'none', color: tokens.text.link, border: `1px solid ${tokens.border.subtle}`,
            borderRadius: 2, cursor: 'pointer', textDecoration: 'none', textAlign: 'center',
          }}>Manage in Clerk</a>
        </div>
      </div>
    </div>
  );
}
