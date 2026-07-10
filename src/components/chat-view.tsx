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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';
import Citation from '@/components/citation';
import { parseCitationsBlock } from '@/lib/citations';
import { MD_COMPONENTS } from '@/lib/markdown';
import { displayForModelId } from '@/lib/provider-display';
import { hydrateCatalog, activeCount } from '@/lib/scope';
import type { QueryExpansion } from '@/lib/types';

interface CitationData {
  tradition: string;
  text: string;
  section: string;
  quote?: string;
  tier: 'verified' | 'proposed' | 'inferred' | 'summary';
}

export interface Message {
  role: 'user' | 'assistant';
  content?: string;
  text?: string;
  citations?: CitationData[];
  /** Query-expansion transparency (todo:9d2ad427): family/domain matches that
   *  fanned the query out. Live-only — arrives via the X-Query-Expansion header
   *  on /api/query; not persisted, so resumed sessions don't show it. */
  expansion?: QueryExpansion[];
  /** Per-response attribution surface (model-selection BRD §7.4). Only
   *  present on persisted assistant messages; live-streaming responses
   *  populate these fields after the stream completes and the row is
   *  written to `queries`. */
  modelUsed?:    string | null;
  inputTokens?:  number | null;
  outputTokens?: number | null;
  costUsd?:      number | null;
}

// Mirrors POST /api/query MAX_QUERY_CHARS. Server is the authoritative gate;
// these only drive the UI counter + send button disabled state.
const QUERY_MAX_CHARS    = 4000;
const QUERY_WARN_CHARS   = 3000;
const QUERY_DANGER_CHARS = 3800;

// Markdown rendering: the shared MD_COMPONENTS map (src/lib/markdown.tsx)
// renders assistant messages identically to the public blog page. User
// messages stay plain text (the user typed those literally; we don't want
// their `**stars**` interpreted). react-markdown re-parses the whole string
// on every update, which is fine for streaming — partial markdown settles
// once content lands.

export interface StudyToc {
  work_label: string;
  entries: { section_span: string; title: string }[];
}

export interface ChatViewProps {
  initialSessionId?: string;
  initialMessages?: Message[];
  /** Resumed study sessions pass the dossier TOC for the sidebar (W5). */
  initialMode?: 'chat' | 'study';
  studyToc?: StudyToc | null;
}

// LocalStorage key for the model-picker default-switch announcement
// banner. Versioned so future banners can ship without un-dismissing
// this one (BRD-model-selection §9 / IMPL §7).
const MODEL_PICKER_BANNER_KEY = 'guru.banner.modelpicker.v1';

export default function ChatView({ initialSessionId, initialMessages, initialMode, studyToc }: ChatViewProps = {}) {
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
  // Study picker (summary-phase-w.md §W5, reworked per UX review): mode is
  // implicit — leave the work picker empty and it's a chat session; pick a
  // work and the session pins to it. No invalid state exists. The unit is
  // the WORK (52 entries grouped by tradition), pinned via its first member
  // text id (the server resolves any member to the same work).
  interface StudyWork { id: string; label: string; tradition: string; members: number; pin_text_id: string }
  const [studyTextId, setStudyTextId] = useState<string>('');
  const [studyLabel, setStudyLabel] = useState<string | null>(
    initialMode === 'study' ? (studyToc?.work_label ?? 'study session') : null);
  const [works, setWorks] = useState<StudyWork[]>([]);
  useEffect(() => {
    if (sessionId || works.length > 0) return;
    fetch('/api/corpus')
      .then(r => r.ok ? r.json() : null)
      .then((data: { works?: StudyWork[] } | null) => {
        if (data?.works) setWorks(data.works);
      })
      .catch(() => { /* picker renders empty; chat still works */ });
  }, [sessionId, works.length]);
  const worksByTradition = useMemo(() => {
    const m = new Map<string, StudyWork[]>();
    for (const w of works) {
      if (!m.has(w.tradition)) m.set(w.tradition, []);
      m.get(w.tradition)!.push(w);
    }
    return m;
  }, [works]);
  const mode: 'chat' | 'study' = studyTextId || initialMode === 'study' ? 'study' : 'chat';
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  // Stick-to-bottom is a ref, not state: scroll events fire on every
  // pixel and React state would re-render the whole tree per tick.
  // The autoscroll effect just reads .current.
  const stickToBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  // Autoscroll only when the user is already near the bottom. Uses
  // instant scrollTop assignment (not scrollIntoView smooth) — smooth
  // scroll on every streamed token compounds into viewport jitter.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

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

  // Live scope status for the footer (todo:5bb914c1). Replaces hardcoded
  // "8 traditions / 34 texts", which drifted from the corpus the moment
  // it shipped. Derived from the same catalog + prefs the settings page
  // uses, so the numbers always agree with what Scope shows. On fetch
  // failure or an empty corpus the line is simply omitted — no fallback
  // constants (feedback_no_fallbacks).
  const [scope, setScope] = useState<{
    activeTexts: number; totalTexts: number; activeTrads: number; totalTrads: number;
  } | null>(null);
  useEffect(() => {
    Promise.all([
      fetch('/api/corpus').then(r => r.ok ? r.json() : Promise.reject(new Error(`corpus ${r.status}`))),
      fetch('/api/preferences').then(r => r.ok ? r.json() : Promise.reject(new Error(`preferences ${r.status}`))),
    ])
      .then(([corpus, prefs]: [
        { traditions: Parameters<typeof hydrateCatalog>[0] },
        Parameters<typeof hydrateCatalog>[1],
      ]) => {
        const catalog = hydrateCatalog(corpus.traditions, prefs);
        const all = Object.values(catalog);
        if (all.length === 0) return;   // empty corpus stays visible as absence
        setScope({
          totalTexts:  all.reduce((n, t) => n + t.texts.length, 0),
          activeTexts: all.reduce((n, t) => n + activeCount(t), 0),
          totalTrads:  all.length,
          activeTrads: all.filter(t => activeCount(t) > 0).length,
        });
      })
      .catch(() => { /* footer line omitted; chat still works */ });
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
    // Sending a new message is an explicit intent to see the response —
    // re-engage autoscroll even if the user had scrolled up to re-read.
    stickToBottomRef.current = true;
    setMessages(prev => [...prev, { role: 'user', content: queryText }]);
    setLoading(true);

    try {
      let sid = sessionId;
      if (!sid) {
        const sessionRes = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: queryText.slice(0, 80),
            ...(mode === 'study' && studyTextId
              ? { mode: 'study', study_text_id: studyTextId }
              : {}),
          }),
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

      // Query-expansion transparency (todo:9d2ad427) — present only when a
      // family/domain match fanned the query out. Parse defensively; a malformed
      // header must never break the stream render.
      let expansion: QueryExpansion[] | undefined;
      const expansionHeader = res.headers.get('X-Query-Expansion');
      if (expansionHeader) {
        try { expansion = JSON.parse(decodeURIComponent(expansionHeader)) as QueryExpansion[]; }
        catch { /* ignore a malformed header */ }
      }

      // Authoritative citations (todo:2fd21c61) — the retrieved chunks_used set,
      // the same one /api/sessions/[id] rehydrates on refresh. Seeding them here
      // makes the "References" cards render live regardless of how the model
      // formatted (or omitted) its CITATIONS tail. Parse defensively; a malformed
      // header must never break the stream render.
      let citations: CitationData[] | undefined;
      const citationsHeader = res.headers.get('X-Citations');
      if (citationsHeader) {
        try { citations = JSON.parse(decodeURIComponent(citationsHeader)) as CitationData[]; }
        catch { /* ignore a malformed header */ }
      }
      const hasCitations = citations !== undefined && citations.length > 0;

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
          ...(expansion && expansion.length > 0 && { expansion }),
          ...(hasCitations && { citations }),
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
            ...(expansion && expansion.length > 0 && { expansion }),
            ...(hasCitations && { citations }),
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
  }, [input, loading, sessionId, tier, mode, studyTextId]);

  const overLimit      = input.length > QUERY_MAX_CHARS;
  const showCounter    = input.length >= QUERY_WARN_CHARS;
  const counterColor   = input.length >= QUERY_DANGER_CHARS ? tokens.text.error : tokens.text.muted;
  const sendDisabled   = !input.trim() || loading || overLimit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 53px)', background: tokens.bg.deep }}>
      {/* Studying strip (W5 + UX review): the persistent mode indicator for
          study sessions — visible from the first message, not just on resume.
          Expands to the dossier TOC when GET /api/sessions/[id] shipped one. */}
      {mode === 'study' && (studyLabel || studyToc) && (
        <details data-testid="study-toc" style={{
          background: tokens.bg.surface,
          borderBottom: `1px solid ${tokens.border.subtle}`,
          padding: mobile ? '8px 14px' : '8px 24px',
          fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.secondary,
        }}>
          <summary style={{ cursor: 'pointer', color: tokens.text.accent, letterSpacing: 1 }}>
            § STUDYING — {studyToc?.work_label ?? studyLabel}
            {studyToc ? ` · contents (${studyToc.entries.length})` : ''}
          </summary>
          {studyToc ? (
            <ol style={{ margin: '8px 0 4px', paddingLeft: 22, maxHeight: 180, overflowY: 'auto', lineHeight: 1.9 }}>
              {studyToc.entries.map(e => (
                <li key={e.section_span}>
                  <span style={{ color: tokens.text.muted }}>{e.section_span}</span> — {e.title}
                </li>
              ))}
            </ol>
          ) : (
            <div style={{ margin: '8px 0 4px', color: tokens.text.muted }}>
              answers in this session are pinned to this work — contents appear on reload
            </div>
          )}
        </details>
      )}
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
      <div ref={scrollContainerRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto', padding: mobile ? '16px 0' : '24px 0', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6, padding: mobile ? '0 16px' : 0 }}>
            <div style={{ fontFamily: tokens.font.display, fontSize: mobile ? 24 : 32, color: tokens.text.accent, letterSpacing: 8, marginBottom: 12 }}>GURU</div>
            <div style={{ fontFamily: tokens.font.mono, fontSize: mobile ? 10 : 11, color: tokens.text.muted, maxWidth: 400, textAlign: 'center', lineHeight: 1.8, marginBottom: 20 }}>
              Ask about concepts across traditions. Every claim is traced to its source.
            </div>
            {/* Study picker: implicit mode — empty select = chat, a picked
                work pins the session. Native optgroups; 52 works, not texts.
                Gold STUDY header + tagline so the mode reads as its own
                feature instead of melding into the description text. */}
            <div style={{
              width: '100%', maxWidth: 400, marginTop: 6,
              background: tokens.bg.surface, border: `1px solid ${studyTextId ? tokens.text.accent : tokens.border.subtle}`,
              borderRadius: 3, padding: mobile ? '12px 14px' : '14px 16px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: tokens.font.mono, fontSize: 11, fontWeight: 700, letterSpacing: 3, color: tokens.text.accent }}>§ STUDY</span>
              </div>
              <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, lineHeight: 1.6 }}>
                Deep dive into the structure and content of a specific text
              </div>
              <select
                aria-label="Study a text"
                value={studyTextId}
                onChange={e => {
                  setStudyTextId(e.target.value);
                  const w = works.find(x => x.pin_text_id === e.target.value);
                  setStudyLabel(w ? w.label : null);
                }}
                style={{
                  background: tokens.bg.deep, border: `1px solid ${studyTextId ? tokens.text.accent : tokens.border.subtle}`,
                  borderRadius: 3, padding: '8px 10px',
                  color: studyTextId ? tokens.text.accent : tokens.text.secondary,
                  fontFamily: tokens.font.mono, fontSize: 11,
                  width: '100%', textOverflow: 'ellipsis', cursor: 'pointer',
                }}>
                <option value="">choose a text — or leave empty to chat freely</option>
                {Array.from(worksByTradition.entries()).map(([trad, ws]) => (
                  <optgroup key={trad} label={trad.replace(/_/g, ' ')}>
                    {ws.map(w => (
                      <option key={w.id} value={w.pin_text_id}>
                        {w.label}{w.members > 1 ? ` (${w.members})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // The model always emits a raw CITATIONS tail (prompt.ts CORE_RULES).
          // Strip it from the prose — the sources render as styled cards below,
          // from chunks_used (msg.citations) or, when retrieval attached none,
          // the parsed block as a fallback. Otherwise the raw block would show
          // as plaintext above the styled cards (todo:50b9a90a).
          const parsed = msg.role === 'assistant' ? parseCitationsBlock(msg.text ?? '') : null;
          const bodyText = parsed ? parsed.body : (msg.text ?? '');
          const cards: CitationData[] =
            msg.citations && msg.citations.length > 0 ? msg.citations : parsed?.citations ?? [];
          return (
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
                {msg.expansion && msg.expansion.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted, letterSpacing: 0.5 }}>
                    {msg.expansion.map((e, k) => (
                      <span
                        key={k}
                        title={`Your query matched the ${e.tier} "${e.label}", expanding the search to ${e.conceptCount} related concepts`}
                        style={{ padding: '2px 8px', border: `1px solid ${tokens.border.subtle}`, borderRadius: 3, whiteSpace: 'nowrap' }}
                      >
                        ↳ {e.label} → {e.conceptCount} concepts
                      </span>
                    ))}
                  </div>
                )}
                <div className="md" style={{ fontFamily: tokens.font.display, fontSize: mobile ? 14 : 15, color: tokens.text.primary, lineHeight: 1.7, marginBottom: cards.length ? 14 : 0, overflowWrap: 'anywhere' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                    {bodyText}
                  </ReactMarkdown>
                </div>
                {cards.length > 0 && (
                  <>
                    <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>References</div>
                    {cards.map((c, j) => <Citation key={j} {...c} />)}
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
                      marginTop: cards.length ? 6 : 10,
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
          );
        })}

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
            placeholder={studyLabel ? `Ask about ${studyLabel}...` : "Ask across traditions..."}
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
        <div style={{ maxWidth: 680, margin: '5px auto 0', fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, display: 'flex', gap: mobile ? 8 : 16, flexWrap: 'wrap' }}>
          {scope && (
            <a
              href="/settings"
              title="Adjust which sources Guru draws on"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {scope.activeTexts < scope.totalTexts
                ? `${scope.activeTexts}/${scope.totalTexts} texts · ${scope.activeTrads}/${scope.totalTrads} traditions in scope`
                : `${scope.totalTexts} texts · ${scope.totalTrads} traditions`}
            </a>
          )}
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
