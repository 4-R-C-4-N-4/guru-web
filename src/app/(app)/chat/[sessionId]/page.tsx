'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { tokens } from '@/styles/tokens';
import ChatView, { recordsToMessages } from '@/components/chat-view';
import type { QueryRecord, Session } from '@/lib/types';

interface SessionData {
  session: Session;
  messages: QueryRecord[];
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ok'; data: SessionData }
  | { status: 'not-found' }
  | { status: 'error' };

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}`)
      .then(async r => {
        if (cancelled) return;
        if (r.status === 404) { setState({ status: 'not-found' }); return; }
        if (!r.ok) { setState({ status: 'error' }); return; }
        const data = await r.json() as SessionData;
        setState({ status: 'ok', data });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (state.status === 'loading') return <Centered>Loading…</Centered>;
  if (state.status === 'not-found') return <Centered>Session not found.</Centered>;
  if (state.status === 'error')     return <Centered>Failed to load session.</Centered>;

  return (
    <ChatView
      initialSessionId={sessionId}
      initialMessages={recordsToMessages(state.data.messages)}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: 'calc(100vh - 53px)', color: tokens.text.muted,
      fontFamily: tokens.font.mono, fontSize: 11,
    }}>
      {children}
    </div>
  );
}
