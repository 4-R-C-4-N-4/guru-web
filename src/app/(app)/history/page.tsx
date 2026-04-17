'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';

interface Session {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function HistoryPage() {
  const mobile  = useIsMobile();
  const router  = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/sessions?limit=50')
      .then(r => r.json())
      .then((d: { sessions: Session[] }) => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: mobile ? '16px 14px' : 24 }}>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, marginBottom: 16, textTransform: 'uppercase' }}>
        Session History
      </div>

      {loading && (
        <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}>Loading…</div>
      )}

      {!loading && sessions.length === 0 && (
        <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted }}>
          No sessions yet. <button onClick={() => router.push('/chat')} style={{ background: 'none', border: 'none', color: tokens.text.link, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>Start a query</button>
        </div>
      )}

      {sessions.map(s => (
        <button key={s.id} onClick={() => router.push(`/chat/${s.id}`)} style={{
          width: '100%', display: 'block', background: tokens.bg.surface,
          border: `1px solid ${tokens.border.subtle}`, borderRadius: 4,
          padding: mobile ? 12 : 16, marginBottom: 6, cursor: 'pointer', textAlign: 'left',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: tokens.font.display, fontSize: mobile ? 14 : 16, color: tokens.text.primary, marginBottom: 4 }}>
                {s.title ?? 'Untitled session'}
              </div>
              <div style={{ fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted }}>
                {s.id.slice(0, 8)}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted }}>{formatDate(s.updated_at)}</div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
