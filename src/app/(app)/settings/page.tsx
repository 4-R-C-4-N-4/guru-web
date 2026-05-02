'use client';

import { useState, useEffect } from 'react';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { CURATED_MODELS, type CuratedSlug } from '@/lib/model';

// Catalog comes from /api/corpus (DISTINCT tradition/text from chunks).
// Empty/error states are rendered as-is — no hardcoded fallback. If this UI
// is empty, the corpus is not restored and that should be visible.
type TraditionsState = Record<string, { active: boolean; texts: Record<string, boolean> }>;

type LoadStatus = 'loading' | 'ready' | 'error';

// Picker copy. The model id portion comes from CURATED_MODELS at
// render time — when the operator bumps a slug, the row updates
// with no copy change. Spec: BRD-model-selection.md §7.3.
const PICKER_OPTIONS: { slug: CuratedSlug; label: string; vibe: string; pricePerQuery: string }[] = [
  { slug: 'deepseek',  label: 'DeepSeek',  vibe: 'cheap, fast',         pricePerQuery: '~$0.005' },
  { slug: 'xai',       label: 'X.AI',      vibe: 'mid-cost, fluent',    pricePerQuery: '~$0.015' },
  { slug: 'anthropic', label: 'Anthropic', vibe: 'premium reasoning',   pricePerQuery: '~$0.045' },
  { slug: 'openai',    label: 'OpenAI',    vibe: 'premium',             pricePerQuery: '~$0.040' },
];

export default function SettingsPage() {
  const mobile = useIsMobile();
  const [traditions, setTraditions] = useState<TraditionsState>({});
  const [status,    setStatus]      = useState<LoadStatus>('loading');
  const [expanded,  setExpanded]    = useState<string | null>(null);
  const [saving,    setSaving]      = useState(false);
  const [saved,     setSaved]       = useState(false);
  const [tier,      setTier]        = useState<'free' | 'pro' | null>(null);
  const [preferredModel, setPreferredModel] = useState<CuratedSlug | null>(null);
  const [modelSaving, setModelSaving] = useState(false);

  // Fetch the corpus catalog + the user's blocked-tradition prefs together,
  // so we can mark blocked entries inactive in a single setState. Also pull
  // tier + preferred_model so the Model section renders in the same paint.
  useEffect(() => {
    Promise.all([
      fetch('/api/corpus').then(r => {
        if (!r.ok) throw new Error(`corpus ${r.status}`);
        return r.json() as Promise<{ traditions: Record<string, { texts: string[] }> }>;
      }),
      fetch('/api/preferences').then(r => {
        if (!r.ok) throw new Error(`preferences ${r.status}`);
        return r.json() as Promise<{ scopeMode: string; blockedTraditions: string[]; preferredModel: string | null }>;
      }),
      fetch('/api/quota').then(r => {
        if (!r.ok) throw new Error(`quota ${r.status}`);
        return r.json() as Promise<{ tier: 'free' | 'pro' }>;
      }),
    ])
      .then(([corpus, prefs, quota]) => {
        const blocked = new Set(
          prefs.scopeMode === 'blacklist' ? prefs.blockedTraditions : []
        );
        const next: TraditionsState = {};
        for (const [name, { texts }] of Object.entries(corpus.traditions)) {
          const isBlocked = blocked.has(name.toLowerCase());
          next[name] = {
            active: !isBlocked,
            texts: Object.fromEntries(texts.map(t => [t, !isBlocked])),
          };
        }
        setTraditions(next);
        setTier(quota.tier);
        setPreferredModel(
          prefs.preferredModel && prefs.preferredModel in CURATED_MODELS
            ? (prefs.preferredModel as CuratedSlug)
            : null,
        );
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
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

  const toggleTradition = (name: string) => {
    setTraditions(prev => {
      const wasActive = prev[name].active;
      return {
        ...prev,
        [name]: {
          active: !wasActive,
          texts: Object.fromEntries(Object.keys(prev[name].texts).map(t => [t, !wasActive])),
        },
      };
    });
  };

  const toggleText = (tradition: string, text: string) => {
    setTraditions(prev => {
      const newTexts = { ...prev[tradition].texts, [text]: !prev[tradition].texts[text] };
      return {
        ...prev,
        [tradition]: { texts: newTexts, active: Object.values(newTexts).some(Boolean) },
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const blocked = Object.entries(traditions)
      .filter(([, d]) => !d.active)
      .map(([name]) => name.toLowerCase());

    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeMode: 'blacklist', blockedTraditions: blocked }),
    }).catch(() => {});

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const totalTexts  = Object.values(traditions).flatMap(t => Object.values(t.texts)).length;
  const activeTexts = Object.values(traditions).flatMap(t => t.active ? Object.values(t.texts).filter(Boolean) : []).length;
  const activeTrad  = Object.values(traditions).filter(t => t.active).length;

  // Resolved-id fallback for display when no preference saved.
  const activeSlug: CuratedSlug = preferredModel ?? 'deepseek';

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: mobile ? '16px 14px' : 24 }}>
      {/* Model section — pro picker, free disabled. */}
      <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, marginBottom: 4, textTransform: 'uppercase' }}>
        Model
        {tier === 'free' && (
          <span style={{ marginLeft: 8, color: tokens.text.accent, fontSize: 9 }}>PRO ONLY</span>
        )}
      </div>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.secondary, marginBottom: 12 }}>
        {tier === 'free'
          ? <>Default: {CURATED_MODELS.deepseek}. <a href="/account" style={{ color: tokens.text.link }}>Upgrade to pick</a>.</>
          : modelSaving ? 'saving…' : `current: ${CURATED_MODELS[activeSlug]}`}
      </div>

      <div style={{ marginBottom: 24 }}>
        {PICKER_OPTIONS.map((opt) => {
          const isActive = preferredModel === opt.slug || (preferredModel === null && opt.slug === 'deepseek');
          const disabled = tier !== 'pro';
          return (
            <label
              key={opt.slug}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: mobile ? '12px 12px' : '10px 14px',
                background: tokens.bg.surface,
                border: `1px solid ${isActive ? tokens.text.accent + '55' : tokens.border.subtle}`,
                borderRadius: 4,
                marginBottom: 5,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <input
                type="radio"
                name="preferredModel"
                value={opt.slug}
                checked={isActive}
                disabled={disabled}
                onChange={() => handleModelChange(opt.slug)}
                style={{ accentColor: tokens.text.accent }}
              />
              <span style={{ fontFamily: tokens.font.display, fontSize: mobile ? 16 : 15, color: tokens.text.primary, minWidth: 90 }}>
                {opt.label}
              </span>
              <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted, flex: 1 }}>
                {CURATED_MODELS[opt.slug]}
              </span>
              <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.secondary, marginRight: 6 }}>
                {opt.vibe}
              </span>
              <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, whiteSpace: 'nowrap' }}>
                {opt.pricePerQuery}
              </span>
            </label>
          );
        })}
      </div>

      <div style={{ fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted, letterSpacing: 2, marginBottom: 4, textTransform: 'uppercase' }}>Corpus Scope</div>
      <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.secondary, marginBottom: 20 }}>
        {status === 'loading' && 'loading…'}
        {status === 'error'   && <span style={{ color: '#c25a7a' }}>failed to load corpus</span>}
        {status === 'ready'   && `${activeTexts}/${totalTexts} texts · ${activeTrad}/${Object.keys(traditions).length} traditions`}
      </div>

      {Object.entries(traditions).map(([name, data]) => {
        const color      = tokens.tradition[name.toLowerCase() as keyof typeof tokens.tradition] ?? tokens.text.secondary;
        const isExpanded = expanded === name;
        const textCount  = Object.values(data.texts).filter(Boolean).length;

        return (
          <div key={name} style={{ background: tokens.bg.surface, border: `1px solid ${data.active ? color + '33' : tokens.border.subtle}`, borderRadius: 4, marginBottom: 5, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: mobile ? '12px 12px' : '10px 14px', cursor: 'pointer', gap: 10, minHeight: mobile ? 48 : 'auto' }}
              onClick={() => setExpanded(isExpanded ? null : name)}>
              {/* Checkbox */}
              <div onClick={e => { e.stopPropagation(); toggleTradition(name); }} style={{
                width: mobile ? 22 : 16, height: mobile ? 22 : 16, borderRadius: 2,
                border: `1.5px solid ${data.active ? color : tokens.border.medium}`,
                background: data.active ? color + '22' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
              }}>
                {data.active && <span style={{ color, fontSize: mobile ? 14 : 11, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontFamily: tokens.font.display, fontSize: mobile ? 16 : 15, color: data.active ? tokens.text.primary : tokens.text.muted, flex: 1 }}>{name}</span>
              <span style={{ fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted }}>{textCount}/{Object.keys(data.texts).length}</span>
              <span style={{ color: tokens.text.muted, fontSize: 10, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
            </div>

            {isExpanded && (
              <div style={{ padding: mobile ? '0 12px 10px 46px' : '0 14px 10px 42px', borderTop: `1px solid ${tokens.border.subtle}` }}>
                {Object.entries(data.texts).map(([text, active]) => (
                  <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: mobile ? '8px 0' : '5px 0', cursor: 'pointer', minHeight: mobile ? 40 : 'auto' }}
                    onClick={() => toggleText(name, text)}>
                    <div style={{
                      width: mobile ? 20 : 13, height: mobile ? 20 : 13, borderRadius: 2,
                      border: `1.5px solid ${active ? color + '88' : tokens.border.medium}`,
                      background: active ? color + '15' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {active && <span style={{ color: color + 'aa', fontSize: mobile ? 12 : 9, lineHeight: 1 }}>✓</span>}
                    </div>
                    <span style={{ fontFamily: tokens.font.mono, fontSize: mobile ? 13 : 12, color: active ? tokens.text.secondary : tokens.text.muted }}>{text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={handleSave} disabled={saving} style={{
          fontFamily: tokens.font.mono, fontSize: 11, padding: mobile ? '12px 20px' : '8px 16px',
          background: tokens.text.accent, color: tokens.bg.deep, border: 'none', borderRadius: 2,
          cursor: saving ? 'default' : 'pointer', fontWeight: 600,
        }}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
        <button onClick={() => setTraditions(prev => Object.fromEntries(
          Object.entries(prev).map(([name, data]) => [name, {
            active: true,
            texts: Object.fromEntries(Object.keys(data.texts).map(t => [t, true])),
          }]),
        ))} style={{
          fontFamily: tokens.font.mono, fontSize: 11, padding: mobile ? '12px 20px' : '8px 16px',
          background: 'none', color: tokens.text.muted, border: `1px solid ${tokens.border.subtle}`, borderRadius: 2, cursor: 'pointer',
        }}>Reset to All</button>
      </div>
    </div>
  );
}
