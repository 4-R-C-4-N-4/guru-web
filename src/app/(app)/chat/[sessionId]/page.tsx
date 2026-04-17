'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { tokens } from '@/styles/tokens';

export default function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // For now redirect to /chat — full session resume is a post-launch feature.
    // The session data is fetched server-side in a future iteration.
    setLoading(false);
  }, [sessionId]);

  if (loading) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 53px)', color: tokens.text.muted, fontFamily: tokens.font.mono, fontSize: 11 }}>
      Session {sessionId} — resume coming soon.
    </div>
  );
}
