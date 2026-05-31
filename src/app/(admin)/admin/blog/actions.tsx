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
