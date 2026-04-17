'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';
import Citation from '@/components/citation';

interface CitationData {
  tradition: string;
  text: string;
  section: string;
  quote?: string;
  tier: 'verified' | 'proposed' | 'inferred';
}

interface Message {
  role: 'user' | 'assistant';
  content?: string;
  text?: string;
  citations?: CitationData[];
  meta?: { chunks: number; traditions: number; verified: number; proposed: number };
}

const SAMPLE_QUERIES = [
  'How does emanation differ between Plotinus and the Zohar?',
  'What traditions describe ego death as prerequisite for awakening?',
  'Compare apophatic theology across Christian and Buddhist thought',
];

export default function ChatPage() {
  const mobile  = useIsMobile();
  const router  = useRouter();
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [quotaUsed,   setQuotaUsed]   = useState<number | null>(null);
  const [quotaLimit,  setQuotaLimit]  = useState<number>(30);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  useEffect(() => {
    fetch('/api/quota').then(r => r.json()).then((d: { used: number; limit: number }) => {
      setQuotaUsed(d.used);
      setQuotaLimit(d.limit);
    }).catch(() => {});
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;

    const queryText = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: queryText }]);
    setLoading(true);

    try {
      // Ensure a session exists
      let sid = sessionId;
      if (!sid) {
        const sessionRes = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: queryText.slice(0, 80) }),
        });
        const sessionData = await sessionRes.json() as { id: string };
        sid = sessionData.id;
        setSessionId(sid);
        router.replace(`/chat/${sid}`);
      }

      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: queryText, sessionId: sid }),
      });

      if (res.status === 429) {
        setMessages(prev => [...prev, { role: 'assistant', text: 'Daily query limit reached. Upgrade to Pro for unlimited queries.' }]);
        setLoading(false);
        return;
      }

      // Update quota from response headers
      const used = res.headers.get('X-Quota-Used');
      if (used) setQuotaUsed(parseInt(used, 10));

      // Stream the response
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullText = '';

      setMessages(prev => [...prev, { role: 'assistant', text: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', text: fullText };
          return next;
        });
      }

    } catch (err) {
      console.error('[chat] query error:', err);
      setMessages(prev => [...prev, { role: 'assistant', text: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, router]);

  const quotaRemaining = quotaLimit - (quotaUsed ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 53px)', background: tokens.bg.deep }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: mobile ? '16px 0' : '24px 0', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6, padding: mobile ? '0 16px' : 0 }}>
            <div style={{ fontFamily: tokens.font.display, fontSize: mobile ? 24 : 32, color: tokens.text.accent, letterSpacing: 8, marginBottom: 12 }}>GURU</div>
            <div style={{ fontFamily: tokens.font.mono, fontSize: mobile ? 10 : 11, color: tokens.text.muted, maxWidth: 400, textAlign: 'center', lineHeight: 1.8, marginBottom: 20 }}>
              Ask about concepts across traditions. Every claim is traced to its source.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 460, padding: mobile ? '0 8px' : 0 }}>
              {SAMPLE_QUERIES.map(q => (
                <button key={q} onClick={() => setInput(q)} style={{
                  background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
                  borderRadius: 3, padding: mobile ? '12px 14px' : '10px 14px',
                  fontFamily: tokens.font.display, fontSize: mobile ? 14 : 13,
                  color: tokens.text.secondary, cursor: 'pointer', textAlign: 'left',
                }}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ maxWidth: 680, margin: '0 auto', padding: mobile ? '0 14px' : '0 24px', marginBottom: mobile ? 18 : 24 }}>
            <div style={{ fontFamily: tokens.font.mono, fontSize: 9, color: msg.role === 'user' ? tokens.text.accent : tokens.text.muted, letterSpacing: 2, marginBottom: 6, textTransform: 'uppercase' }}>
              {msg.role === 'user' ? 'You' : 'Guru'}
            </div>

            {msg.role === 'user' ? (
              <div style={{ fontFamily: tokens.font.display, fontSize: mobile ? 15 : 16, color: tokens.text.primary, lineHeight: 1.6, padding: mobile ? '10px 12px' : '12px 16px', background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4 }}>
                {msg.content}
              </div>
            ) : (
              <div>
                <div style={{ fontFamily: tokens.font.display, fontSize: mobile ? 14 : 15, color: tokens.text.primary, lineHeight: 1.7, marginBottom: msg.citations?.length ? 14 : 0, whiteSpace: 'pre-wrap' }}>
                  {msg.text}
                </div>
                {msg.citations && msg.citations.length > 0 && (
                  <>
                    <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>References</div>
                    {msg.citations.map((c, j) => <Citation key={j} {...c} />)}
                    <div style={{ display: 'flex', gap: mobile ? 10 : 16, marginTop: 10, fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, padding: '8px 0', borderTop: `1px solid ${tokens.border.subtle}`, flexWrap: 'wrap' }}>
                      <span>◆ {msg.meta?.verified}</span>
                      <span>◇ {msg.meta?.proposed}</span>
                      <span>{msg.meta?.traditions} traditions</span>
                      <span>{msg.meta?.chunks} chunks</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ maxWidth: 680, margin: '0 auto', padding: mobile ? '0 14px' : '0 24px' }}>
            <div style={{ fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, letterSpacing: 2, marginBottom: 8 }}>GURU</div>
            <div style={{ display: 'flex', gap: 4, padding: '14px 0' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: tokens.text.accent, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`, opacity: 0.4 }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{ padding: mobile ? '12px 12px max(12px, env(safe-area-inset-bottom))' : '16px 24px', borderTop: `1px solid ${tokens.border.subtle}`, background: tokens.bg.surface }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask across traditions..."
            style={{
              flex: 1, padding: mobile ? '13px 12px' : '12px 16px',
              background: tokens.bg.deep, border: `1px solid ${tokens.border.subtle}`,
              borderRadius: 3, color: tokens.text.primary,
              fontFamily: tokens.font.display, fontSize: 16,
              outline: 'none', WebkitAppearance: 'none', minWidth: 0,
            } as React.CSSProperties}
          />
          <button onClick={handleSend} disabled={!input.trim() || loading} style={{
            padding: mobile ? '13px 16px' : '12px 20px',
            background: input.trim() && !loading ? tokens.text.accent : tokens.bg.raised,
            border: 'none', borderRadius: 3,
            color: input.trim() && !loading ? tokens.bg.deep : tokens.text.muted,
            fontFamily: tokens.font.mono, fontSize: 11, cursor: input.trim() && !loading ? 'pointer' : 'default',
            fontWeight: 600, letterSpacing: 1, flexShrink: 0,
          }}>QUERY</button>
        </div>
        <div style={{ maxWidth: 680, margin: '5px auto 0', fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, display: 'flex', gap: mobile ? 8 : 16, flexWrap: 'wrap' }}>
          <span>8 traditions</span>
          <span>34 texts</span>
          {quotaUsed !== null && <span>{quotaRemaining}/{quotaLimit} remaining today</span>}
        </div>
      </div>
    </div>
  );
}
