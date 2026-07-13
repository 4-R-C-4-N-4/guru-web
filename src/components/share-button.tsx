'use client';

/**
 * src/components/share-button.tsx
 *
 * Share strip for an existing chat session (todo:8d6c6886, parent
 * todo:36421ff5). Renders nothing until the session exists and has at
 * least one completed assistant turn — a share snapshots the turns that
 * exist, so an empty session has nothing to share (the API 400s on it
 * anyway; the gate here just keeps the strip out of new chats).
 *
 * SHARE → POST /api/sessions/[id]/share (idempotent server-side: re-POST
 * returns the existing active link) → panel with the absolute URL, COPY,
 * and REVOKE (DELETE). API errors render as-is in the strip — no
 * fallback content, per the no-silent-fallbacks rule.
 */

import { useState, useCallback } from 'react';
import { tokens } from '@/styles/tokens';

const MONO = { fontFamily: tokens.font.mono, fontSize: 11 } as const;

const BUTTON_STYLE = {
  ...MONO,
  background: 'none',
  border: `1px solid ${tokens.border.subtle}`,
  borderRadius: 3,
  color: tokens.text.link,
  cursor: 'pointer',
  letterSpacing: 1,
  padding: '4px 10px',
  textTransform: 'uppercase',
} as const;

export default function ShareButton({
  sessionId,
  hasTurns,
}: {
  sessionId: string | null;
  hasTurns: boolean;
}) {
  const [open, setOpen]         = useState(false);
  const [busy, setBusy]         = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const share = useCallback(async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/share`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `Share failed (${res.status})`);
        return;
      }
      setShareUrl(`${window.location.origin}${(body as { url: string }).url}`);
      setOpen(true);
    } catch {
      setError('Share failed — network error');
    } finally {
      setBusy(false);
    }
  }, [sessionId, busy]);

  const copy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError('Copy failed — copy the link manually');
    }
  }, [shareUrl]);

  const revoke = useCallback(async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/share`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `Revoke failed (${res.status})`);
        return;
      }
      setShareUrl(null);
      setOpen(false);
    } catch {
      setError('Revoke failed — network error');
    } finally {
      setBusy(false);
    }
  }, [sessionId, busy]);

  if (!sessionId || !hasTurns) return null;

  return (
    <div
      data-testid="share-strip"
      style={{
        background: tokens.bg.surface,
        borderBottom: `1px solid ${tokens.border.subtle}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        padding: '6px 24px',
      }}
    >
      {error && (
        <span role="alert" style={{ ...MONO, color: tokens.text.error, marginRight: 'auto' }}>
          {error}
        </span>
      )}
      {open && shareUrl ? (
        <>
          <input
            readOnly
            value={shareUrl}
            aria-label="Public share link"
            onFocus={e => e.currentTarget.select()}
            style={{
              ...MONO,
              background: tokens.bg.deep,
              border: `1px solid ${tokens.border.subtle}`,
              borderRadius: 3,
              color: tokens.text.secondary,
              flex: '0 1 340px',
              minWidth: 0,
              padding: '4px 8px',
            }}
          />
          <button type="button" onClick={copy} disabled={busy} style={BUTTON_STYLE}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            style={{ ...BUTTON_STYLE, color: tokens.text.error }}
          >
            Revoke
          </button>
          <button type="button" onClick={() => setOpen(false)} style={BUTTON_STYLE}>
            Close
          </button>
        </>
      ) : (
        <button type="button" onClick={share} disabled={busy} style={BUTTON_STYLE}>
          {busy ? 'Sharing…' : 'Share'}
        </button>
      )}
    </div>
  );
}
