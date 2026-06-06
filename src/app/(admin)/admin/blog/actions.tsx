'use client';

/**
 * src/app/(admin)/admin/blog/actions.tsx
 *
 * Per-row action buttons for the blog admin views (IMPL T7). These are the
 * first MUTATING admin UI controls — they POST to the T4 routes and refresh
 * the server-rendered list on success. Generate holds an in-flight state
 * while the synchronous generation request runs (BRD §6).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/styles/tokens';

type Action = 'generate' | 'publish' | 'reject' | 'archive';

const LABELS: Record<Action, string> = {
  generate: 'Generate',
  publish: 'Publish',
  reject: 'Reject',
  archive: 'Archive',
};

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: tokens.font.mono,
    fontSize: 11,
    padding: '4px 10px',
    marginRight: 6,
    background: 'none',
    color: disabled ? tokens.text.muted : tokens.text.link,
    border: `1px solid ${tokens.border.medium}`,
    borderRadius: 2,
    cursor: disabled ? 'default' : 'pointer',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  };
}

function ActionButton({ id, action }: { id: string; action: Action }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/blog/${id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        setErr(`HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setErr('request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button type="button" disabled={busy} onClick={run} style={btnStyle(busy)}>
        {busy && action === 'generate' ? 'Generating…' : LABELS[action]}
      </button>
      {err && (
        <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.error }}>
          {err}
        </span>
      )}
    </span>
  );
}

/** Actions shown on a queued seed: generate, or reject. */
export function QueueActions({ id }: { id: string }) {
  return (
    <>
      <ActionButton id={id} action="generate" />
      <ActionButton id={id} action="reject" />
    </>
  );
}

/** Actions shown on a draft / needs_attention row. */
export function DraftActions({ id, canPublish }: { id: string; canPublish: boolean }) {
  return (
    <>
      {canPublish && <ActionButton id={id} action="publish" />}
      <ActionButton id={id} action="reject" />
      <ActionButton id={id} action="archive" />
    </>
  );
}

/** Action shown on a published row: archive (unpublish from the index). */
export function PublishedActions({ id }: { id: string }) {
  return <ActionButton id={id} action="archive" />;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: tokens.font.mono,
  fontSize: 12,
  padding: '8px 10px',
  background: tokens.bg.deep,
  color: tokens.text.primary,
  border: `1px solid ${tokens.border.medium}`,
  borderRadius: 2,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontFamily: tokens.font.mono,
  fontSize: 10,
  color: tokens.text.muted,
  letterSpacing: 1,
  textTransform: 'uppercase',
  display: 'block',
  margin: '10px 0 4px',
};

/**
 * Inline manual editor for a draft (or a salvageable needs_attention row) — the
 * operator's scalpel on LLM output before publishing. Collapsed to an "Edit
 * draft" button; expands to title/dek/content fields that PUT to the edit route
 * and refresh the list. Drafts aren't public, so no cache concerns.
 */
export function DraftEditor({
  id,
  title,
  dek,
  content,
}: {
  id: string;
  title: string | null;
  dek: string | null;
  content: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title ?? '');
  const [d, setD] = useState(dek ?? '');
  const [c, setC] = useState(content ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setT(title ?? '');
    setD(dek ?? '');
    setC(content ?? '');
    setErr(null);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/blog/${id}/edit`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: t, dek: d, content: c }),
      });
      if (!res.ok) {
        setErr(res.status === 400 ? 'title and content are required' : `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setErr('request failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={btnStyle(false)}>
        Edit draft
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        border: `1px solid ${tokens.border.medium}`,
        borderRadius: 4,
        background: tokens.bg.deep,
      }}
    >
      <label style={labelStyle}>Title</label>
      <input style={inputStyle} value={t} onChange={e => setT(e.target.value)} />

      <label style={labelStyle}>Dek</label>
      <input style={inputStyle} value={d} onChange={e => setD(e.target.value)} />

      <label style={labelStyle}>Content (markdown)</label>
      <textarea
        style={{ ...inputStyle, minHeight: 320, lineHeight: 1.6, resize: 'vertical' }}
        value={c}
        onChange={e => setC(e.target.value)}
      />

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" disabled={busy} onClick={save} style={btnStyle(busy)}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { reset(); setOpen(false); }}
          style={btnStyle(busy)}
        >
          Cancel
        </button>
        {err && (
          <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.error }}>
            {err}
          </span>
        )}
      </div>
    </div>
  );
}
