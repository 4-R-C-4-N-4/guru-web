/**
 * src/components/ask-view.tsx
 *
 * The anonymous first-question surface (todo:f138c9ad). A signed-out
 * visitor asks Guru one real question and sees the real product — full
 * corpus retrieval, real citations, the same markdown/citation rendering
 * as the authenticated chat — then the signup wall.
 *
 * It streams from POST /api/query/guest and reuses the exact answer
 * rendering the authenticated chat uses (ReactMarkdown + remarkCiteLinks +
 * MD_COMPONENTS + Citation), so the anonymous answer is byte-for-byte the
 * product, not a demo. Deliberately trimmed vs chat-view: no sessions,
 * quota, prefs, voice, study mode, or share — a guest has none of those.
 */
'use client';

import { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tokens } from '@/styles/tokens';
import Citation from '@/components/citation';
import GuestWall from '@/components/guest-wall';
import { parseCitationsBlock } from '@/lib/citations';
import { remarkCiteLinks } from '@/lib/remark-citations';
import { MD_COMPONENTS } from '@/lib/markdown';
import { displayForModelId } from '@/lib/provider-display';

interface CitationData {
  id?: string;
  tradition: string;
  text: string;
  section: string;
  quote?: string;
}

// Mirrors MAX_QUERY_CHARS in /api/query/guest. Server is authoritative.
const MAX_QUERY_CHARS = 4000;

export default function AskView() {
  const [input, setInput] = useState('');
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<CitationData[]>([]);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [consumed, setConsumed] = useState(false);
  const [wallMessage, setWallMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const overLimit = input.length > MAX_QUERY_CHARS;
  const sendDisabled = loading || consumed || !input.trim() || overLimit;

  const handleAsk = useCallback(async () => {
    const queryText = input.trim();
    if (!queryText || loading || consumed || overLimit) return;

    setError(null);
    setQuestion(queryText);
    setAnswer('');
    setCitations([]);
    setModelUsed(null);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/query/guest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: queryText }),
      });

      if (res.status === 429) {
        // Entitlement already spent (returning visitor / IP cap). Show the
        // wall straight away with the server's message.
        const body = await res.json().catch(() => ({}));
        setConsumed(true);
        setWallMessage(typeof body?.error === 'string' ? body.error : undefined);
        setLoading(false);
        return;
      }
      if (!res.ok || !res.body) {
        setError('Something went wrong. Please try again.');
        setLoading(false);
        return;
      }

      setModelUsed(res.headers.get('X-Model-Used'));

      // Authoritative citations from the retrieved chunks (X-Citations) —
      // same source the authenticated chat seeds. Parse defensively.
      const citationsHeader = res.headers.get('X-Citations');
      if (citationsHeader) {
        try { setCitations(JSON.parse(decodeURIComponent(citationsHeader)) as CitationData[]); }
        catch { /* a malformed header must never break the render */ }
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setAnswer(full);
      }

      // One free question, now spent — show the wall below the answer.
      setConsumed(true);
    } catch (err) {
      console.error('[ask] guest query error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [input, loading, consumed, overLimit]);

  // Strip the model's raw CITATIONS tail from the prose; cards render below
  // from the authoritative X-Citations set, or the parsed block as fallback.
  const parsed = parseCitationsBlock(answer);
  const bodyText = parsed ? parsed.body : answer;
  const cards: CitationData[] = citations.length > 0 ? citations : parsed?.citations ?? [];
  const modelDisplay = displayForModelId(modelUsed);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 20px 64px', color: tokens.text.primary }}>
      <div style={{ maxWidth: 680, margin: '48px auto 28px', textAlign: 'center' }}>
        <h1 style={{ fontFamily: tokens.font.display, fontSize: 34, fontWeight: 500, margin: '0 0 10px', color: tokens.text.primary }}>
          Ask Guru anything
        </h1>
        <p style={{ fontFamily: tokens.font.display, fontSize: 16, color: tokens.text.muted, lineHeight: 1.6, margin: 0 }}>
          One free question across the world&apos;s esoteric traditions — traced to its sources, every claim cited.
        </p>
      </div>

      {/* Composer — hidden once the free question is spent. */}
      {!consumed && (
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            className="input"
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); }
            }}
            placeholder="Ask across traditions..."
            rows={2}
            disabled={loading}
            style={{
              flex: 1, padding: '13px 16px',
              background: tokens.bg.deep, border: `1px solid ${tokens.border.subtle}`,
              borderRadius: 3, color: tokens.text.primary,
              fontFamily: tokens.font.display, fontSize: 16,
              WebkitAppearance: 'none', minWidth: 0, width: '100%',
              resize: 'none', overflowY: 'auto', overflowWrap: 'anywhere',
              lineHeight: 1.45,
            } as React.CSSProperties}
          />
          <button
            className={sendDisabled ? 'btn' : 'btn btn-primary'}
            onClick={handleAsk}
            disabled={sendDisabled}
            title={overLimit ? `Query exceeds ${MAX_QUERY_CHARS}-character limit` : undefined}
            style={{ padding: '13px 22px', letterSpacing: 1, flexShrink: 0 }}
          >
            Ask
          </button>
        </div>
      )}
      {!consumed && (
        <div style={{ maxWidth: 680, margin: '6px auto 0', fontFamily: tokens.font.mono, fontSize: 10, color: overLimit ? tokens.text.accent : tokens.text.muted, textAlign: 'right' }}>
          {input.length > 0 && `${input.length}/${MAX_QUERY_CHARS}`}
        </div>
      )}

      {error && (
        <div style={{ maxWidth: 680, margin: '20px auto 0', fontFamily: tokens.font.mono, fontSize: 12, color: tokens.text.accent, textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Question echo */}
      {question && (
        <div style={{ maxWidth: 680, margin: '36px auto 0' }}>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.accent, letterSpacing: 2, marginBottom: 6, textTransform: 'uppercase' }}>You</div>
          <div style={{ fontFamily: tokens.font.display, fontSize: 16, color: tokens.text.primary, lineHeight: 1.6, padding: '12px 16px', background: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`, borderRadius: 4, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
            {question}
          </div>
        </div>
      )}

      {/* Answer */}
      {(answer || loading) && (
        <div style={{ maxWidth: 680, margin: '20px auto 0' }}>
          <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, marginBottom: 6, textTransform: 'uppercase' }}>Guru</div>
          {answer ? (
            <>
              <div className="md" style={{ fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.primary, lineHeight: 1.7, marginBottom: cards.length ? 14 : 0, overflowWrap: 'anywhere' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCiteLinks(cards)]} components={MD_COMPONENTS}>
                  {bodyText}
                </ReactMarkdown>
              </div>
              {cards.length > 0 && (
                <>
                  <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>References</div>
                  {cards.map((c, j) => <Citation key={j} {...c} />)}
                </>
              )}
              {modelDisplay && (
                <div style={{ marginTop: cards.length ? 6 : 10, fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted }}>
                  via <span style={{ color: modelDisplay.color }}>{modelDisplay.name}</span>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', gap: 4, padding: '10px 0' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: tokens.text.accent, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`, opacity: 0.4 }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Signup wall — below the answer, at the highest-intent moment. */}
      {consumed && <GuestWall message={wallMessage} />}
    </div>
  );
}
