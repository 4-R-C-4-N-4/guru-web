/**
 * src/components/admin/ExpandableQuery.tsx
 *
 * Native <details>/<summary>. Collapsed: one-row digest with truncated
 * prompt + model + cost + tokens + time. Expanded: full prompt, full
 * response, chunks_used as tradition/text/section triples, costing
 * breakdown (the model_pricing row used), nested <details> for raw
 * JSON.
 *
 * Spec: BRD-admin-ui §1.8, §1.9; design BRD §3.7.
 *
 * Native <details> is the load-bearing choice — Ctrl-F searches the
 * collapsed content (full prompt is in the DOM, just clipped) which
 * is the operator's main diagnostic flow. A useState-driven custom
 * expand component would not.
 */

import { tokens } from '@/styles/tokens';
import type { SessionQueryRow } from '@/lib/admin-queries';

export interface ExpandableQueryProps {
  query: SessionQueryRow;
  /** When true, the <details> is open by default. Used on the
   *  per-query page (BRD §1.9). */
  defaultOpen?: boolean;
  /** When true, the inner raw-JSON <details> is open by default. */
  rawOpenByDefault?: boolean;
  /** Optional anchor target (the session view uses ?expand=all-style
   *  links via fragment IDs; including an id makes those links work). */
  anchorId?: string;
  /** Raw row JSON — only needed on the per-query page. Pass undefined
   *  in the session view to skip the raw block entirely. */
  raw?: Record<string, unknown>;
}

export function ExpandableQuery({
  query, defaultOpen = false, rawOpenByDefault = false,
  anchorId, raw,
}: ExpandableQueryProps) {
  const summary = truncate(query.query_text, 80);
  const time = new Date(query.created_at).toISOString().slice(0, 19).replace('T', ' ');
  const chunkRows = parseChunks(query.chunks_used);

  return (
    <details
      id={anchorId}
      open={defaultOpen}
      style={{
        borderBottom: `1px solid ${tokens.border.subtle}`,
        padding: '8px 0',
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '1fr auto auto auto auto',
          gap: 12,
          alignItems: 'baseline',
          fontFamily: tokens.font.mono,
          fontSize: 12,
        }}
      >
        <span style={{ color: tokens.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </span>
        <span style={{ color: tokens.text.muted, fontSize: 11 }}>{query.model_used}</span>
        <span style={{ color: tokens.text.primary, fontVariantNumeric: 'tabular-nums' }}>
          ${query.cost_usd?.toFixed(6) ?? '0.000000'}
        </span>
        <span style={{ color: tokens.text.muted, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
          {(query.input_tokens ?? 0)}↓/{(query.output_tokens ?? 0)}↑
        </span>
        <span style={{ color: tokens.text.muted, fontSize: 11 }}>{time}</span>
      </summary>

      <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: `1px solid ${tokens.border.subtle}` }}>
        <Block label="Prompt">
          <pre style={preStyle}>{query.query_text}</pre>
        </Block>

        <Block label="Response">
          <pre style={preStyle}>{query.response_text}</pre>
        </Block>

        <Block label={`Retrieved chunks (${chunkRows.length})`}>
          {chunkRows.length === 0 ? (
            <div style={{ color: tokens.text.muted, fontSize: 11 }}>No chunks recorded.</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.primary }}>
              {chunkRows.map((c, i) => (
                <li key={i} style={{ padding: '1px 0' }}>
                  <span style={{ color: tokens.text.muted }}>{c.tradition}</span>
                  {' / '}{c.text}
                  {' / '}<span style={{ color: tokens.text.muted }}>{c.section}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block label="Costing">
          <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: tokens.font.mono }}>
            <tbody>
              <Row k="tier_used" v={query.tier_used} />
              <Row k="model" v={query.model_used} />
              <Row k="input_tokens" v={String(query.input_tokens ?? 0)} />
              <Row k="output_tokens" v={String(query.output_tokens ?? 0)} />
              <Row k="cached_input_tokens" v={String(query.cached_input_tokens)} />
              <Row k="cost_usd" v={`$${query.cost_usd?.toFixed(6) ?? '0.000000'}`} />
              <Row k="rate input"  v={`$${query.pricing_input_per_mtok?.toFixed(4) ?? '—'} / Mtok`} />
              <Row k="rate output" v={`$${query.pricing_output_per_mtok?.toFixed(4) ?? '—'} / Mtok`} />
              <Row k="rate cached_input"
                   v={query.pricing_cached_input_per_mtok === null
                        ? '—'
                        : `$${query.pricing_cached_input_per_mtok.toFixed(4)} / Mtok`} />
              <Row k="effective_from"
                   v={query.pricing_effective_from
                        ? new Date(query.pricing_effective_from).toISOString()
                        : '—'} />
            </tbody>
          </table>
        </Block>

        {raw ? (
          <Block label="Raw JSON">
            <details open={rawOpenByDefault}>
              <summary style={{ color: tokens.text.muted, fontSize: 11, cursor: 'pointer' }}>
                {rawOpenByDefault ? 'hide raw row' : 'show raw row'}
              </summary>
              <pre style={{ ...preStyle, fontSize: 10 }}>
                {JSON.stringify(raw, null, 2)}
              </pre>
            </details>
          </Block>
        ) : null}
      </div>
    </details>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

interface ParsedChunk { tradition: string; text: string; section: string }

function parseChunks(raw: unknown): ParsedChunk[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c): ParsedChunk | null => {
      if (typeof c !== 'object' || c === null) return null;
      const o = c as Record<string, unknown>;
      const tradition = pickString(o, ['tradition']) ?? '?';
      const text      = pickString(o, ['text_name', 'text']) ?? '?';
      const section   = pickString(o, ['section']) ?? '?';
      return { tradition, text, section };
    })
    .filter((c): c is ParsedChunk => c !== null);
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string') return v;
  }
  return null;
}

const preStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: tokens.bg.surface,
  border: `1px solid ${tokens.border.subtle}`,
  padding: 8,
  fontSize: 11,
  fontFamily: tokens.font.mono,
  color: tokens.text.primary,
  margin: 0,
};

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 10, color: tokens.text.muted,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
      }}>{label}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td style={{ color: tokens.text.muted, padding: '1px 12px 1px 0' }}>{k}</td>
      <td style={{ color: tokens.text.primary, padding: '1px 0' }}>{v}</td>
    </tr>
  );
}
