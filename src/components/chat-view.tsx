'use client';

/**
 * src/components/chat-view.tsx
 *
 * Shared chat UI used by both /chat (new conversation) and
 * /chat/[sessionId] (resumed conversation). Accepts optional
 * initialSessionId + initialMessages so the [sessionId] route can
 * hydrate from GET /api/sessions/[id].
 *
 * URL update on first message uses window.history.replaceState (NOT
 * router.replace) so the component doesn't unmount mid-stream — App
 * Router treats /chat and /chat/[sessionId] as distinct components,
 * and a real navigation would swap them out and lose the in-flight
 * fetch.
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

export interface Message {
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

// Mirrors POST /api/query MAX_QUERY_CHARS. Server is the authoritative gate;
// these only drive the UI counter + send button disabled state.
const QUERY_MAX_CHARS    = 4000;
const QUERY_WARN_CHARS   = 3000;
const QUERY_DANGER_CHARS = 3800;

// ── Markdown rendering ───────────────────────────────────────────────
// Assistant messages from DeepSeek/Claude come back as standard markdown
// (headings, **bold**, lists, code fences, blockquotes). Render via
// react-markdown with overrides that match the existing token system —
// display font for prose, mono for code, accent for links.
//
// User messages stay plain text (the user typed those literally; we
// don't want their `**stars**` interpreted).
//
// react-markdown re-parses the whole string on every update, which is
// fine for streaming — partial markdown ("##" before the heading text
// arrives) renders as best-effort and "settles" once content lands.
const MD_COMPONENTS: Components = {
  h1: (p) => <h2 style={{ fontFamily: tokens.font.display, fontSize: 22, fontWeight: 600, color: tokens.text.primary, margin: '14px 0 8px', letterSpacing: 1 }} {...p} />,
  h2: (p) => <h3 style={{ fontFamily: tokens.font.display, fontSize: 19, fontWeight: 600, color: tokens.text.primary, margin: '12px 0 6px' }} {...p} />,
  h3: (p) => <h4 style={{ fontFamily: tokens.font.display, fontSize: 16, fontWeight: 600, color: tokens.text.primary, margin: '10px 0 4px' }} {...p} />,
  h4: (p) => <h5 style={{ fontFamily: tokens.font.mono,    fontSize: 11, color: tokens.text.muted,   margin: '10px 0 4px', letterSpacing: 1, textTransform: 'uppercase' }} {...p} />,
  p:  (p) => <p style={{ margin: '0 0 10px', lineHeight: 1.7 }} {...p} />,
  strong: (p) => <strong style={{ fontWeight: 600, color: tokens.text.primary }} {...p} />,
  em:     (p) => <em style={{ fontStyle: 'italic', color: tokens.text.secondary }} {...p} />,
  ul: (p) => <ul style={{ margin: '4px 0 10px', paddingLeft: 22, lineHeight: 1.7 }} {...p} />,
  ol: (p) => <ol style={{ margin: '4px 0 10px', paddingLeft: 22, lineHeight: 1.7 }} {...p} />,
  li: (p) => <li style={{ marginBottom: 2 }} {...p} />,
  blockquote: (p) => <blockquote style={{ margin: '8px 0', padding: '4px 12px', borderLeft: `2px solid ${tokens.text.accent}`, color: tokens.text.secondary, fontStyle: 'italic' }} {...p} />,
  a: (p) => <a target="_blank" rel="noreferrer" style={{ color: tokens.text.link, textDecoration: 'underline', textDecorationColor: 'rgba(122,158,194,0.4)' }} {...p} />,
  code: ({ className, children, ...rest }) => {
    // Block-level code (```lang) gets a className; inline code does not.
    const inline = !className;
    if (inline) {
      return (
        <code style={{
          fontFamily: tokens.font.mono, fontSize: '0.9em',
          background: tokens.bg.raised, padding: '1px 5px', borderRadius: 2,
          color: tokens.text.primary,
        }} {...rest}>{children}</code>
      );
    }
    return <code className={className} style={{ fontFamily: tokens.font.mono }} {...rest}>{children}</code>;
  },
  pre: (p) => (
    <pre style={{
      background: tokens.bg.raised,
      border: `1px solid ${tokens.border.subtle}`,
      borderRadius: 3, padding: 12, margin: '8px 0',
      overflowX: 'auto',
      fontFamily: tokens.font.mono, fontSize: 12, lineHeight: 1.5,
    }} {...p} />
  ),
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${tokens.border.subtle}`, margin: '14px 0' }} />,
  table: (p) => <table style={{ borderCollapse: 'collapse', margin: '8px 0', fontSize: 13 }} {...p} />,
  th:    (p) => <th style={{ borderBottom: `1px solid ${tokens.border.subtle}`, padding: '4px 8px', textAlign: 'left', color: tokens.text.muted, fontFamily: tokens.font.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }} {...p} />,
  td:    (p) => <td style={{ borderBottom: `1px solid ${tokens.border.subtle}`, padding: '4px 8px' }} {...p} />,
};

export interface ChatViewProps {
  initialSessionId?: string;
  initialMessages?: Message[];
}

export default function ChatView({ initialSessionId, initialMessages }: ChatViewProps = {}) {
  const mobile  = useIsMobile();
  const [messages,    setMessages]    = useState<Message[]>(initialMessages ?? []);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [sessionId,   setSessionId]   = useState<string | null>(initialSessionId ?? null);
  const [quotaUsed,   setQuotaUsed]   = useState<number | null>(null);
  const [quotaLimit,  setQuotaLimit]  = useState<number>(30);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  // Auto-grow the textarea up to a max height (then it scrolls). Reset to
  // 'auto' first so shrinking works when the user deletes content.
  const inputMaxHeight = mobile ? 144 : 160;
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, inputMaxHeight)}px`;
  }, [input, inputMaxHeight]);

  useEffect(() => {
    fetch('/api/quota').then(r => r.json()).then((d: { used: number; limit: number }) => {
      setQuotaUsed(d.used);
      setQuotaLimit(d.limit);
    }).catch(() => {});
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return;
    if (input.length > QUERY_MAX_CHARS) return;

    const queryText = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: queryText }]);
    setLoading(true);

    try {
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
        // Update the URL without unmounting — see file header. Wrapped in a
        // try/catch because some environments (tests, embedded webviews)
        // disable history mutation.
        try { window.history.replaceState({}, '', `/chat/${sid}`); } catch { /* ignore */ }
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

      const used = res.headers.get('X-Quota-Used');
      if (used) setQuotaUsed(parseInt(used, 10));

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
  }, [input, loading, sessionId]);

  const quotaRemaining = quotaLimit - (quotaUsed ?? 0);
  const overLimit      = input.length > QUERY_MAX_CHARS;
  const showCounter    = input.length >= QUERY_WARN_CHARS;
  const counterColor   = input.length >= QUERY_DANGER_CHARS ? '#c25a7a' : tokens.text.muted;
  const sendDisabled   = !input.trim() || loading || overLimit;

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
              <div style={{ fontFamily: tokens.font.display, fontSize: mobile ? 15 : 16, color: tokens.text.primary, lineHeight: 1.6, padding: mobile ? '10px 12px' : '12px 16px', background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                {msg.content}
              </div>
            ) : (
              <div>
                <div className="md" style={{ fontFamily: tokens.font.display, fontSize: mobile ? 14 : 15, color: tokens.text.primary, lineHeight: 1.7, marginBottom: msg.citations?.length ? 14 : 0, overflowWrap: 'anywhere' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                    {msg.text ?? ''}
                  </ReactMarkdown>
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
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask across traditions..."
            rows={1}
            style={{
              flex: 1, padding: mobile ? '13px 12px' : '12px 16px',
              background: tokens.bg.deep, border: `1px solid ${tokens.border.subtle}`,
              borderRadius: 3, color: tokens.text.primary,
              fontFamily: tokens.font.display, fontSize: 16,
              outline: 'none', WebkitAppearance: 'none', minWidth: 0, width: '100%',
              resize: 'none', overflowY: 'auto', overflowWrap: 'anywhere',
              maxHeight: inputMaxHeight, lineHeight: 1.45,
            } as React.CSSProperties}
          />
          <button onClick={handleSend} disabled={sendDisabled}
            title={overLimit ? `Query exceeds ${QUERY_MAX_CHARS}-character limit` : undefined}
            style={{
              padding: mobile ? '13px 16px' : '12px 20px',
              background: !sendDisabled ? tokens.text.accent : tokens.bg.raised,
              border: 'none', borderRadius: 3,
              color: !sendDisabled ? tokens.bg.deep : tokens.text.muted,
              fontFamily: tokens.font.mono, fontSize: 11, cursor: !sendDisabled ? 'pointer' : 'default',
              fontWeight: 600, letterSpacing: 1, flexShrink: 0,
            }}>QUERY</button>
        </div>
        <div style={{ maxWidth: 680, margin: '5px auto 0', fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, display: 'flex', gap: mobile ? 8 : 16, flexWrap: 'wrap' }}>
          <span>8 traditions</span>
          <span>34 texts</span>
          {quotaUsed !== null && <span>{quotaRemaining}/{quotaLimit} remaining today</span>}
          {showCounter && <span style={{ color: counterColor, marginLeft: 'auto' }}>{input.length}/{QUERY_MAX_CHARS}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Convert persisted QueryRecord rows (from GET /api/sessions/[id]) into
 * the in-memory Message[] format the chat UI renders. Each record becomes
 * two messages: the user's query and the assistant's response.
 *
 * Citations come pre-joined from the API (todo:89af833a) — /api/sessions/[id]
 * does a single batched lookup against corpus.chunks for the whole session.
 * Tier defaults to 'verified' on the API side because chunks_used persists
 * chunk IDs only, not the tier the chunk had at retrieval time.
 */
export function recordsToMessages(records: ReadonlyArray<{
  query_text: string;
  response_text: string;
  citations?: CitationData[];
}>): Message[] {
  const out: Message[] = [];
  for (const r of records) {
    out.push({ role: 'user', content: r.query_text });
    out.push({
      role: 'assistant',
      text: r.response_text,
      citations: r.citations,
    });
  }
  return out;
}
