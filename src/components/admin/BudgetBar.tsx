/**
 * src/components/admin/BudgetBar.tsx
 *
 * Used / limit fill bar. Two stacked instances form the dual-axis
 * display from BRD-admin-ui §1.7. When `limit` is null the bar is
 * hidden and a muted "no cap" tag replaces it — this is the
 * load-bearing case for the day pro flips to having a usd_limit.
 *
 * Spec: BRD-admin-ui-design §3.5.
 */

import { tokens } from '@/styles/tokens';

export interface BudgetBarProps {
  label: string;
  used: number;
  limit: number | null;
  /** Format the numeric label. Default: integer. */
  format?: (n: number) => string;
}

export function BudgetBar({ label, used, limit, format = (n) => Intl.NumberFormat().format(n) }: BudgetBarProps) {
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const overBudget = limit !== null && used > limit;

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
        <span style={{ color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
        <span style={{ color: tokens.text.primary, fontVariantNumeric: 'tabular-nums', fontFamily: tokens.font.mono }}>
          {format(used)}
          {limit === null
            ? <span style={{ color: tokens.text.muted, marginLeft: 6 }}>no cap</span>
            : <span style={{ color: tokens.text.muted }}> / {format(limit)}</span>}
        </span>
      </div>
      {limit !== null ? (
        <div style={{ background: tokens.bg.surface, height: 6 }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: overBudget ? '#a37a7a' : tokens.tier.verified,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
