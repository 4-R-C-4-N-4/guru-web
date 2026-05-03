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

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';
import Citation from '@/components/citation';
import { displayForModelId } from '@/lib/provider-display';

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
  /** Per-response attribution surface (model-selection BRD §7.4). Only
   *  present on persisted assistant messages; live-streaming responses
   *  populate these fields after the stream completes and the row is
   *  written to `queries`. */
  modelUsed?:    string | null;
  inputTokens?:  number | null;
  outputTokens?: number | null;
  costUsd?:      number | null;
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

// LocalStorage key for the model-picker default-switch announcement
// banner. Versioned so future banners can ship without un-dismissing
// this one (BRD-model-selection §9 / IMPL §7).
const MODEL_PICKER_BANNER_KEY = 'guru.banner.modelpicker.v1';

export default function ChatView({ initialSessionId, initialMessages }: ChatViewProps = {}) {
  const mobile  = useIsMobile();
  const [messages,    setMessages]    = useState<Message[]>(initialMessages ?? []);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [sessionId,   setSessionId]   = useState<string | null>(initialSessionId ?? null);
  const [quotaUsed,   setQuotaUsed]   = useState<number | null>(null);
  const [tier,        setTier]        = useState<'free' | 'pro' | null>(null);
  // Banner dismissal lives in component state for the active session.
  // Persistence to localStorage happens in dismissPickerBanner so the
  // dismissed state survives reloads. The visible/hidden derivation is
  // a pure compute (useMemo below) — keeps us out of the
  // react-hooks/set-state-in-effect rule.
  const [bannerDismissed, setBannerDismissed] = useState(false);
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
    fetch('/api/quota').then(r => r.json()).then((d: { used: number; tier?: 'free' | 'pro' }) => {
      setQuotaUsed(d.used);
      if (d.tier) setTier(d.tier);
    }).catch(() => {});
  }, []);

  // Show the picker banner only when the user is pro AND localStorage
  // hasn't been marked dismissed AND the current session hasn't just
  // dismissed it. Free users never see it. New post-launch signups
  // may briefly see it before dismissing — accepted UX cost vs. the
  // complexity of gating on users.created_at < banner_release_date.
  //
  // localStorage is read during render via useMemo (key on tier so we
  // re-evaluate when tier resolves) — keeps us out of the
  // react-hooks/set-state-in-effect rule that would fire on a
  // useEffect+setState pattern.
  const showPickerBanner = useMemo(() => {
    if (tier !== 'pro') return false;
    if (bannerDismissed) return false;
    try {
      return localStorage.getItem(MODEL_PICKER_BANNER_KEY) !== '1';
    } catch {
      // localStorage blocked (private mode etc.) — show the banner;
      // dismiss in this session works via setBannerDismissed.
      return true;
    }
  }, [tier, bannerDismissed]);

  const dismissPickerBanner = useCallback(() => {
    setBannerDismissed(true);
    try { localStorage.setItem(MODEL_PICKER_BANNER_KEY, '1'); } catch { /* ignore */ }
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
        // Tier-aware copy: free user → upgrade nudge, pro user →
        // try-tomorrow. Both axes (queries cap, USD cap behind the
        // scenes) collapse to the same user-visible message
        // (todo:e8105324).
        const text = tier === 'pro'
          ? 'Daily question limit reached. Resets at midnight.'
          : 'Daily question limit reached. Upgrade to Pro for more.';
        setMessages(prev => [...prev, { role: 'assistant', text }]);
        setLoading(false);
        return;
      }

      const used = res.headers.get('X-Quota-Used');
      if (used) setQuotaUsed(parseInt(used, 10));

      // Resolved model id arrives in headers — populates the
      // attribution line in-session without waiting for a session
      // reload. Tokens + cost still arrive on the next reload via
      // recordsToMessages (they're null until persistence +
      // finalizeBudget complete). Spec: model-selection BRD §7.4.
      const modelUsedHeader = res.headers.get('X-Model-Used');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullText = '';

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          text: '',
          ...(modelUsedHeader && { modelUsed: modelUsedHeader }),
        },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = {
            role: 'assistant',
            text: fullText,
            ...(modelUsedHeader && { modelUsed: modelUsedHeader }),
          };
          return next;
        });
      }

    } catch (err) {
      console.error('[chat] query error:', err);
      setMessages(prev => [...prev, { role: 'assistant', text: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, tier]);

  const overLimit      = input.length > QUERY_MAX_CHARS;
  const showCounter    = input.length >= QUERY_WARN_CHARS;
  const counterColor   = input.length >= QUERY_DANGER_CHARS ? '#c25a7a' : tokens.text.muted;
  const sendDisabled   = !input.trim() || loading || overLimit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 53px)', background: tokens.bg.deep }}>
      {/* One-time announcement banner — pro users only, dismissible.
          BRD-model-selection §9 step 4. Drops after the model-picker
          rollout settles (track on the parent ticket and remove the
          banner block once telemetry shows >95% of pro users have
          dismissed). */}
      {showPickerBanner && (
        <div
          role="status"
          data-testid="model-picker-banner"
          style={{
            background: tokens.bg.surface,
            borderBottom: `1px solid ${tokens.border.subtle}`,
            padding: mobile ? '10px 14px' : '10px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: tokens.font.mono,
            fontSize: 11,
            color: tokens.text.secondary,
          }}
        >
          <span style={{ color: tokens.text.accent }}>NEW</span>
          <span style={{ flex: 1 }}>
            Pro now lets you choose how Guru answers — Anthropic for
            careful comparison, OpenAI for analysis, X.AI for
            conversational. Adjust in{' '}
            <a href="/settings" style={{ color: tokens.text.link, textDecoration: 'underline' }}>
              Settings
            </a>
            .
          </span>
          <button
            type="button"
            onClick={dismissPickerBanner}
            aria-label="Dismiss banner"
            style={{
              background: 'none',
              border: 'none',
              color: tokens.text.muted,
              cursor: 'pointer',
              fontFamily: tokens.font.mono,
              fontSize: 14,
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

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
                {/* Per-response attribution badge — provider only.
                    Tokens + cost are deliberately not surfaced to
                    users; admin views show those for diagnostics.
                    todo:e8105324. */}
                {(() => {
                  const display = displayForModelId(msg.modelUsed);
                  if (!display) return null;
                  return (
                    <div style={{
                      marginTop: msg.citations?.length ? 6 : 10,
                      fontFamily: tokens.font.mono,
                      fontSize: 10,
                      color: tokens.text.muted,
                    }}>
                      via <span style={{ color: display.color }}>{display.name}</span>
                    </div>
                  );
                })()}
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
          {/* Today's question count. We deliberately don't show a
              hard ceiling (X/Y) because the effective ceiling
              varies by selected model — the USD cap binds at ~30
              for DeepSeek, ~4 for Anthropic, etc. — and a static
              "/30" misleads pro users who switched picker. The 429
              surfaces the actual cap when it binds. todo:e8105324. */}
          {quotaUsed !== null && <span>{quotaUsed} today</span>}
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
  // Attribution columns surfaced from /api/sessions/[id]. Optional so
  // the helper still types older fixtures that don't carry them.
  model_used?:    string | null;
  input_tokens?:  number | null;
  output_tokens?: number | null;
  cost_usd?:      number | null;
}>): Message[] {
  const out: Message[] = [];
  for (const r of records) {
    out.push({ role: 'user', content: r.query_text });
    // Spread the attribution fields conditionally so older fixtures
    // (and back-compat tests) without them stay structurally
    // identical to their pre-attribution shape.
    out.push({
      role: 'assistant',
      text: r.response_text,
      citations: r.citations,
      ...(r.model_used    != null && { modelUsed:    r.model_used    }),
      ...(r.input_tokens  != null && { inputTokens:  r.input_tokens  }),
      ...(r.output_tokens != null && { outputTokens: r.output_tokens }),
      ...(r.cost_usd      != null && { costUsd:      r.cost_usd      }),
    });
  }
  return out;
}
