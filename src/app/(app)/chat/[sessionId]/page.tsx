'use client';

import { useParams } from 'next/navigation';
import { tokens } from '@/styles/tokens';

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: 'calc(100vh - 53px)', color: tokens.text.muted,
      fontFamily: tokens.font.mono, fontSize: 11,
    }}>
      Session {sessionId} — resume coming soon.
    </div>
  );
}
