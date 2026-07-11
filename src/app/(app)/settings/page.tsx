'use client';

/**
 * src/app/(app)/settings/page.tsx — Scope + model + voice preferences.
 *
 * Redesigned under todo:195d1b2f. Corpus Scope leads the page (the nav
 * item is labelled Scope) and now honors the full preference model:
 *
 * - blockedTexts PERSIST. The old page rendered per-text checkboxes but
 *   only saved tradition-level blocks — partial selections silently
 *   vanished on reload even though prefs/retriever support them end to
 *   end (graph.ts filters on text_id). Blocking a text label blocks ALL
 *   its member ids (grouped works ship every id via text_items[].ids).
 * - Scope autosaves (debounced) like model/voice — one save model for
 *   the whole page instead of two.
 * - Checkboxes are real <input type="checkbox"> driven visuals (.check
 *   in globals.css): keyboard + AT semantics for free.
 * - The spectrum bar renders the corpus by tradition hue, weighted by
 *   chunk count; segments dim as their texts leave scope.
 *
 * Empty/error corpus states render as-is — no hardcoded fallback. If
 * this UI is empty, the corpus is not restored and that must be visible.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { IconCheck, IconChevronRight, IconMinus } from '@/components/icons';
// Import from curated-models (not model.ts) so the client bundle
// doesn't pull in the OpenAI SDK that model.ts initialises.
import { CURATED_MODELS, type CuratedSlug } from '@/lib/curated-models';
import { PROVIDER_DISPLAY } from '@/lib/provider-display';
import type { VoiceSlug } from '@/lib/types';

import { hydrateCatalog, buildScopeSave, activeCount, scopeTotals, type Catalog } from '@/lib/scope';

type LoadStatus = 'loading' | 'ready' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Picker order. Provider name + questions-per-day come from
// PROVIDER_DISPLAY so the picker stays consistent with the chat
// attribution badge (todo:e8105324). Sorted DeepSeek first because
// it's the default; remainder by descending capacity so the
// tradeoff is visible at a glance.
const PICKER_ORDER: CuratedSlug[] = ['deepseek', 'xai', 'anthropic', 'openai'];

// Voice picker order + display copy. The slug → overlay mapping lives in
// src/lib/prompt.ts; the user-facing name + one-line description live
// here because they're UI-layer copy that shouldn't ride in the LLM
// prompt. Spec: BRD-chat-voice.md §7, IMPL §7.
const VOICE_ORDER: VoiceSlug[] = ['scholar', 'woowoo'];

const VOICE_DISPLAY: Record<VoiceSlug, { name: string; description: string }> = {
  scholar: {
    name:        'Scholar',
    description: 'Rigorous, grounded, precise prose.',
  },
  woowoo: {
    name:        'Woowoo',
    description: 'Energetic and connection-forward. Alive to the material.',
  },
};

const AUTOSAVE_MS = 600;

function traditionColor(name: string): string {
  return tokens.tradition[name.toLowerCase() as keyof typeof tokens.tradition]
    ?? tokens.text.secondary;
}

export default function SettingsPage() {
  const mobile = useIsMobile();
  const [catalog,  setCatalog]  = useState<Catalog>({});
  const [status,   setStatus]   = useState<LoadStatus>('loading');
  const [saveState, setSaveState] = useState<SaveStatus>('idle');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tier,     setTier]     = useState<'free' | 'pro' | null>(null);
  const [preferredModel, setPreferredModel] = useState<CuratedSlug | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [preferredVoice, setPreferredVoice] = useState<VoiceSlug>('scholar');
  const [voiceSaving, setVoiceSaving] = useState(false);

  // Autosave bookkeeping: skip the hydration setCatalog, debounce edits.
  // pendingPayload holds the not-yet-persisted save so it can be flushed
  // on unmount or retried after a failure; inFlight lets a newer save
  // abort a superseded PUT so responses can't land out of order.
  const hydrated  = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPayload = useRef<ReturnType<typeof buildScopeSave> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Fetch the corpus catalog + the user's scope prefs together so blocked
  // state lands in a single setState. Tier + preferred model/voice ride
  // the same paint.
  useEffect(() => {
    Promise.all([
      fetch('/api/corpus').then(r => {
        if (!r.ok) throw new Error(`corpus ${r.status}`);
        return r.json() as Promise<{
          traditions: Record<string, {
            text_items: { id: string; label: string; ids: string[] }[];
            chunks: number;
          }>;
        }>;
      }),
      fetch('/api/preferences').then(r => {
        if (!r.ok) throw new Error(`preferences ${r.status}`);
        return r.json() as Promise<{
          scopeMode: string;
          blockedTraditions: string[];
          blockedTexts: string[];
          preferredModel: string | null;
          preferredVoice: VoiceSlug;
        }>;
      }),
      fetch('/api/quota').then(r => {
        if (!r.ok) throw new Error(`quota ${r.status}`);
        return r.json() as Promise<{ tier: 'free' | 'pro' }>;
      }),
    ])
      .then(([corpus, prefs, quota]) => {
        setCatalog(hydrateCatalog(corpus.traditions, prefs));
        setTier(quota.tier);
        setPreferredModel(
          prefs.preferredModel && prefs.preferredModel in CURATED_MODELS
            ? (prefs.preferredModel as CuratedSlug)
            : null,
        );
        // Defensive: trust the API value but fall back to scholar if it's
        // an unknown slug somehow (drift, future-removed voice).
        setPreferredVoice(
          prefs.preferredVoice in VOICE_DISPLAY ? prefs.preferredVoice : 'scholar',
        );
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  // ── Scope autosave ──────────────────────────────────────────────────
  // Debounced PUT after any catalog edit. blockedTraditions carries fully
  // blocked traditions; blockedTexts carries the member ids of partially
  // blocked ones (fully blocked traditions don't repeat their text ids —
  // the tradition filter already excludes them in retrieval).
  const flushScopeSave = useCallback(async () => {
    const payload = pendingPayload.current;
    if (!payload) return;
    pendingPayload.current = null;
    // A superseded PUT must not land after this one — abort it. The
    // aborted call sees its own signal flagged and yields saveState.
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setSaveState('saving');
    const res = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).catch(() => null);
    if (ctrl.signal.aborted) return;
    if (!res || !res.ok) {
      // Surface the failure and keep the payload — the header offers a
      // retry, the next edit resends, and unmount flushes it too.
      pendingPayload.current = pendingPayload.current ?? payload;
      setSaveState('error');
      return;
    }
    setSaveState('saved');
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState('idle'), 2000);
  }, []);

  useEffect(() => {
    if (status !== 'ready') return;
    if (!hydrated.current) { hydrated.current = true; return; }

    pendingPayload.current = buildScopeSave(catalog);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushScopeSave, AUTOSAVE_MS);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [catalog, status, flushScopeSave]);

  // Unmount flush: an edit made inside the debounce window (or one whose
  // save failed) must not be silently dropped when the user navigates
  // away. keepalive lets the PUT outlive the page.
  useEffect(() => () => {
    const payload = pendingPayload.current;
    if (!payload) return;
    pendingPayload.current = null;
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const toggleTradition = useCallback((name: string) => {
    setCatalog(prev => {
      const wasActive = activeCount(prev[name]) > 0;
      return {
        ...prev,
        [name]: {
          ...prev[name],
          texts: prev[name].texts.map(x => ({ ...x, active: !wasActive })),
        },
      };
    });
  }, []);

  const toggleText = useCallback((name: string, label: string) => {
    setCatalog(prev => ({
      ...prev,
      [name]: {
        ...prev[name],
        texts: prev[name].texts.map(x => x.label === label ? { ...x, active: !x.active } : x),
      },
    }));
  }, []);

  // Solo: keep only this tradition in scope. The mixer-console move for
  // "compare X against nothing else".
  const soloTradition = useCallback((name: string) => {
    setCatalog(prev => Object.fromEntries(Object.entries(prev).map(([n, t]) => [n, {
      ...t,
      texts: t.texts.map(x => ({ ...x, active: n === name })),
    }])));
  }, []);

  const includeAll = useCallback(() => {
    setCatalog(prev => Object.fromEntries(Object.entries(prev).map(([n, t]) => [n, {
      ...t,
      texts: t.texts.map(x => ({ ...x, active: true })),
    }])));
  }, []);

  const toggleExpand = useCallback((name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const handleModelChange = async (slug: CuratedSlug) => {
    if (slug === preferredModel) return;
    setModelSaving(true);
    setPreferredModel(slug);  // optimistic
    const res = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredModel: slug }),
    }).catch(() => null);
    setModelSaving(false);
    if (!res || !res.ok) {
      // Roll back on failure — surface state to the user.
      setPreferredModel(preferredModel);
    }
  };

  const handleVoiceChange = async (slug: VoiceSlug) => {
    if (slug === preferredVoice) return;
    const prior = preferredVoice;
    setVoiceSaving(true);
    setPreferredVoice(slug);  // optimistic
    const res = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredVoice: slug }),
    }).catch(() => null);
    setVoiceSaving(false);
    if (!res || !res.ok) {
      // Roll back on failure. Includes the 403 server-side pro-gate
      // case (free user trying a non-default voice via direct edit).
      setPreferredVoice(prior);
    }
  };

  const totals = useMemo(() => scopeTotals(catalog), [catalog]);

  const anythingBlocked = totals.activeTexts < totals.texts;

  const saveLabel = {
    idle:   '',
    saving: 'saving…',
    saved:  'saved',
    error:  '',  // error renders as a retry button instead
  }[saveState];

  const pad = mobile ? '12px 12px' : '10px 14px';

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: mobile ? '16px 14px' : 24 }}>

      {/* ── Corpus Scope ─────────────────────────────────────────────── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <span className="t-eyebrow">Corpus Scope</span>
          <span className="t-data" aria-live="polite" style={{
            color: saveState === 'error' ? tokens.text.error : tokens.text.muted,
          }}>
            {saveState === 'error'
              ? (
                <button
                  onClick={flushScopeSave}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    font: 'inherit', color: 'inherit', cursor: 'pointer',
                    textDecoration: 'underline', textUnderlineOffset: 2,
                  }}
                >
                  save failed — retry
                </button>
              )
              : saveLabel}
          </span>
        </div>

        {status === 'loading' && <div className="t-ui">loading corpus…</div>}
        {status === 'error' && (
          <div className="t-ui" style={{ color: tokens.text.error }}>
            failed to load the corpus catalog — reload to retry
          </div>
        )}

        {status === 'ready' && (
          <>
            {/* Spectrum bar: the corpus by tradition, weighted by chunk
                count. Segments dim as their texts leave scope. */}
            <div aria-hidden style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1, marginBottom: 10 }}>
              {Object.entries(catalog).map(([name, t]) => {
                const frac = t.texts.length ? activeCount(t) / t.texts.length : 0;
                return (
                  <div
                    key={name}
                    title={name.replace(/_/g, ' ')}
                    style={{
                      flexGrow: t.chunks,
                      flexBasis: 0,
                      background: traditionColor(name),
                      opacity: frac === 0 ? 0.12 : 0.3 + 0.7 * frac,
                      transition: 'opacity 0.25s ease',
                    }}
                  />
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
              <span className="t-data">
                {totals.activeTexts} of {totals.texts} texts · {totals.activeTraditions} of {totals.traditions} traditions in scope
              </span>
              {anythingBlocked && (
                <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={includeAll}>
                  Include all
                </button>
              )}
            </div>
            <p className="t-ui" style={{ color: tokens.text.muted, margin: '0 0 14px' }}>
              Sources you exclude are never retrieved or cited.
            </p>

            {Object.entries(catalog).map(([name, t]) => {
              const color    = traditionColor(name);
              const active   = activeCount(t);
              const isOpen   = expanded.has(name);
              const someOn   = active > 0;
              const partial  = someOn && active < t.texts.length;
              return (
                <div
                  key={name}
                  className="row"
                  style={{ marginBottom: 5, overflow: 'hidden', '--row-hue': `${color}66` } as React.CSSProperties}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: pad, minHeight: mobile ? 48 : 'auto' }}>
                    <label className="check" style={{ '--check-hue': color } as React.CSSProperties}>
                      <input
                        type="checkbox"
                        checked={someOn}
                        // Partially scoped traditions read as "mixed" to AT
                        // and show a dash, not a full check — a bare checked
                        // box at 1/16 texts misstates what's in scope.
                        ref={el => { if (el) el.indeterminate = partial; }}
                        onChange={() => toggleTradition(name)}
                        aria-label={`Include ${name.replace(/_/g, ' ')}`}
                      />
                      <span className="check-box" style={{ width: mobile ? 20 : 16, height: mobile ? 20 : 16 }}>
                        {partial
                          ? <IconMinus size={mobile ? 13 : 11} strokeWidth={2} />
                          : <IconCheck size={mobile ? 13 : 11} strokeWidth={2} />}
                      </span>
                    </label>

                    <button
                      onClick={() => toggleExpand(name)}
                      aria-expanded={isOpen}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: 10,
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        textAlign: 'left', minWidth: 0,
                      }}
                    >
                      <span style={{
                        fontFamily: 'var(--font-display)', fontSize: mobile ? 16 : 15,
                        color: someOn ? tokens.text.primary : tokens.text.muted,
                        flex: 1, textTransform: 'capitalize',
                      }}>
                        {name.replace(/_/g, ' ')}
                      </span>
                      <span className="t-data" style={{ fontSize: 11, color: tokens.text.muted }}>
                        {active}/{t.texts.length}
                      </span>
                      <IconChevronRight
                        size={12}
                        style={{
                          color: tokens.text.muted, flexShrink: 0,
                          transform: isOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s ease',
                        }}
                      />
                    </button>

                    <button
                      className="reveal t-data"
                      onClick={() => soloTradition(name)}
                      aria-label={`Only ${name.replace(/_/g, ' ')}`}
                      style={{
                        background: 'none', border: `1px solid ${tokens.border.medium}`,
                        borderRadius: 3, color: tokens.text.secondary,
                        fontSize: 10, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      only
                    </button>
                  </div>

                  {isOpen && (
                    <div style={{
                      borderTop: `1px solid ${tokens.border.subtle}`,
                      padding: mobile ? '8px 12px 10px 44px' : '8px 14px 10px 42px',
                      display: 'grid',
                      gridTemplateColumns: mobile ? '1fr' : '1fr 1fr',
                      gap: mobile ? 0 : '0 16px',
                    }}>
                      {t.texts.map(x => (
                        <label
                          key={x.label}
                          className="check"
                          style={{ padding: mobile ? '8px 0' : '5px 0', minHeight: mobile ? 40 : 'auto', '--check-hue': color } as React.CSSProperties}
                        >
                          <input
                            type="checkbox"
                            checked={x.active}
                            onChange={() => toggleText(name, x.label)}
                          />
                          <span className="check-box" style={{ width: mobile ? 18 : 14, height: mobile ? 18 : 14 }}>
                            <IconCheck size={mobile ? 11 : 9} strokeWidth={2} />
                          </span>
                          <span className="t-ui" style={{
                            fontSize: mobile ? 13 : 12,
                            color: x.active ? tokens.text.secondary : tokens.text.muted,
                          }}>
                            {x.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </section>

      {/* ── Model ────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 36 }}>
        <div className="t-eyebrow" style={{ marginBottom: 6 }}>
          Model
          {tier === 'free' && (
            <span style={{ marginLeft: 8, color: tokens.text.accent, fontSize: 10, letterSpacing: 1 }}>Pro only</span>
          )}
        </div>
        <div className="t-ui" style={{ marginBottom: 12 }}>
          {tier === 'free'
            ? <>Default model. <a href="/account" style={{ color: tokens.text.link }}>Upgrade to Pro</a> to choose another.</>
            : modelSaving
              ? 'saving…'
              : 'Choose how Guru answers. Some models allow fewer questions per day.'}
        </div>

        {PICKER_ORDER.map((slug) => {
          const display = PROVIDER_DISPLAY[slug];
          const isActive = preferredModel === slug || (preferredModel === null && slug === 'deepseek');
          const disabled = tier !== 'pro';
          const isDefault = slug === 'deepseek';
          return (
            <label
              key={slug}
              className="row"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: pad, marginBottom: 5,
                borderColor: isActive ? `${display.color}88` : undefined,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                '--row-hue': `${display.color}66`,
              } as React.CSSProperties}
            >
              <input
                type="radio"
                name="preferredModel"
                value={slug}
                checked={isActive}
                disabled={disabled}
                onChange={() => handleModelChange(slug)}
                style={{ accentColor: display.color }}
              />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: mobile ? 16 : 15,
                color: isActive ? display.color : tokens.text.primary,
                minWidth: 100,
              }}>
                {display.name}
              </span>
              <span className="t-data" style={{ fontSize: 11, color: tokens.text.muted, flex: 1, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {isDefault && <span style={{ color: tokens.text.secondary, marginRight: 8 }}>Default</span>}
                ~{display.questionsPerDay} questions per day
              </span>
            </label>
          );
        })}
      </section>

      {/* ── Voice ────────────────────────────────────────────────────── */}
      <section>
        <div className="t-eyebrow" style={{ marginBottom: 6 }}>
          Voice
          {tier === 'free' && (
            <span style={{ marginLeft: 8, color: tokens.text.accent, fontSize: 10, letterSpacing: 1 }}>Pro only</span>
          )}
        </div>
        <div className="t-ui" style={{ marginBottom: 12 }}>
          {tier === 'free'
            ? <>Default voice. <a href="/account" style={{ color: tokens.text.link }}>Upgrade to Pro</a> to choose another.</>
            : voiceSaving
              ? 'saving…'
              : 'How Guru speaks. Source-grounding and citation rules apply to every voice.'}
        </div>

        {VOICE_ORDER.map((slug) => {
          const display = VOICE_DISPLAY[slug];
          const isActive = preferredVoice === slug;
          const disabled = tier !== 'pro';
          return (
            <label
              key={slug}
              className="row"
              style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: pad, marginBottom: 5,
                borderColor: isActive ? `${tokens.text.accent}88` : undefined,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              } as React.CSSProperties}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="radio"
                  name="preferredVoice"
                  value={slug}
                  checked={isActive}
                  disabled={disabled}
                  onChange={() => handleVoiceChange(slug)}
                  style={{ accentColor: tokens.text.accent }}
                />
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: mobile ? 16 : 15,
                  color: isActive ? tokens.text.accent : tokens.text.primary,
                }}>
                  {display.name}
                </span>
              </div>
              <div className="t-ui" style={{ marginLeft: 24, fontSize: 12, color: tokens.text.muted }}>
                {display.description}
              </div>
            </label>
          );
        })}
      </section>
    </div>
  );
}
