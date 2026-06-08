'use client';

/**
 * src/app/(admin)/admin/blog/seed-form.tsx
 *
 * The "add seed" form (IMPL T7) — the sole seeding entry this phase. The
 * operator names a cross-tradition concept pair, picks a model, optionally
 * narrows the corpus scope, and adds an angle. POSTs to /api/admin/blog/seed
 * and refreshes the queue.
 *
 * Per the T6 decision (option B), the scope tree + model picker are a SIMPLE
 * control rebuilt here rather than shared components extracted from settings —
 * settings/page.tsx stays untouched. The catalog is fetched server-side and
 * passed in as a prop (admin can't call the requireUser-gated /api/corpus).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/styles/tokens';
import { CURATED_MODELS, type CuratedSlug } from '@/lib/curated-models';

type Catalog = Record<string, { texts: string[] }>;

const MODEL_SLUGS = Object.keys(CURATED_MODELS) as CuratedSlug[];

const inputStyle: React.CSSProperties = {
  fontFamily: tokens.font.mono,
  fontSize: 12,
  padding: '6px 8px',
  background: tokens.bg.raised,
  color: tokens.text.primary,
  border: `1px solid ${tokens.border.medium}`,
  borderRadius: 2,
  width: '100%',
};

const labelStyle: React.CSSProperties = {
  fontFamily: tokens.font.mono,
  fontSize: 10,
  color: tokens.text.muted,
  textTransform: 'uppercase',
  letterSpacing: 1,
  display: 'block',
  marginBottom: 4,
};

export function SeedForm({ catalog }: { catalog: Catalog }) {
  const router = useRouter();
  const traditions = Object.keys(catalog);

  // Seeding mode: 'topic' (free-text prompt, the general/default path) or
  // 'concepts' (the cross-tradition pair).
  const [mode, setMode] = useState<'topic' | 'concepts'>('topic');
  const [topic, setTopic] = useState('');
  const [conceptA, setConceptA] = useState('');
  const [conceptB, setConceptB] = useState('');
  const [angle, setAngle] = useState('');
  const [model, setModel] = useState<CuratedSlug>('deepseek');
  // Scope: 'all' (no narrowing) or 'blacklist' (block the checked traditions).
  // KISS rebuild — tradition-level only, no per-text tree (settings keeps that).
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function toggleBlocked(t: string) {
    setBlocked(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const blockedTraditions = [...blocked];
    const common = {
      model,
      scope_mode: blockedTraditions.length ? 'blacklist' : 'all',
      blocked_traditions: blockedTraditions,
    };

    let payload: Record<string, unknown>;
    if (mode === 'topic') {
      if (!topic.trim()) {
        setErr('a prompt is required');
        return;
      }
      payload = { ...common, topic: topic.trim() };
    } else {
      if (!conceptA.trim() || !conceptB.trim()) {
        setErr('both concept ids are required');
        return;
      }
      payload = {
        ...common,
        concept_ids: [conceptA.trim(), conceptB.trim()],
        angle: angle.trim() || null,
      };
    }

    setBusy(true);
    try {
      const res = await fetch('/api/admin/blog/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error ?? `HTTP ${res.status}`);
        return;
      }
      // Reset and refresh the queue.
      setTopic('');
      setConceptA('');
      setConceptB('');
      setAngle('');
      setBlocked(new Set());
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontFamily: tokens.font.mono,
          fontSize: 12,
          padding: '6px 14px',
          background: tokens.text.accent,
          color: tokens.bg.deep,
          border: 'none',
          borderRadius: 2,
          cursor: 'pointer',
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: 'uppercase',
          marginBottom: 24,
        }}
      >
        + Add seed
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: tokens.bg.surface,
        border: `1px solid ${tokens.border.subtle}`,
        borderRadius: 4,
        padding: 20,
        marginBottom: 24,
        maxWidth: 560,
      }}
    >
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        {(['topic', 'concepts'] as const).map(m => (
          <label key={m} style={{ fontFamily: tokens.font.mono, fontSize: 12, color: mode === m ? tokens.text.accent : tokens.text.secondary, cursor: 'pointer' }}>
            <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} style={{ marginRight: 4 }} />
            {m === 'topic' ? 'From a prompt' : 'From concepts'}
          </label>
        ))}
      </div>

      {mode === 'topic' ? (
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Prompt / topic</label>
          <textarea
            value={topic}
            onChange={e => setTopic(e.target.value)}
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical', fontFamily: tokens.font.display, fontSize: 14 }}
            placeholder="e.g. the role of silence in mystical union across traditions"
          />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Concept A (id)</label>
              <input value={conceptA} onChange={e => setConceptA(e.target.value)} style={inputStyle} placeholder="e.g. concept.emanation" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Concept B (id)</label>
              <input value={conceptB} onChange={e => setConceptB(e.target.value)} style={inputStyle} placeholder="e.g. concept.logos" />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Angle (optional)</label>
            <input value={angle} onChange={e => setAngle(e.target.value)} style={inputStyle} placeholder="the thread to pursue" />
          </div>
        </>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Model</label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {MODEL_SLUGS.map(slug => (
            <label key={slug} style={{ fontFamily: tokens.font.mono, fontSize: 12, color: tokens.text.secondary, cursor: 'pointer' }}>
              <input type="radio" name="model" checked={model === slug} onChange={() => setModel(slug)} style={{ marginRight: 4 }} />
              {slug}
            </label>
          ))}
        </div>
      </div>

      {traditions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Scope — block traditions (optional)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
            {traditions.map(t => (
              <label key={t} style={{ fontFamily: tokens.font.mono, fontSize: 11, color: blocked.has(t) ? tokens.text.muted : tokens.text.secondary, cursor: 'pointer' }}>
                <input type="checkbox" checked={blocked.has(t)} onChange={() => toggleBlocked(t)} style={{ marginRight: 4 }} />
                {t}
              </label>
            ))}
          </div>
        </div>
      )}

      {err && (
        <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.error, marginBottom: 12 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={busy}
          style={{
            fontFamily: tokens.font.mono, fontSize: 12, padding: '6px 14px',
            background: tokens.text.accent, color: tokens.bg.deep, border: 'none',
            borderRadius: 2, cursor: busy ? 'default' : 'pointer', fontWeight: 600,
            letterSpacing: 1, textTransform: 'uppercase',
          }}
        >
          {busy ? 'Adding…' : 'Add to queue'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            fontFamily: tokens.font.mono, fontSize: 12, padding: '6px 14px',
            background: 'none', color: tokens.text.secondary,
            border: `1px solid ${tokens.border.medium}`, borderRadius: 2, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
