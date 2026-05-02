/**
 * src/components/admin/TabularSparkline.tsx
 *
 * The v1 chart. Per data BRD §1.16, exists so the overview is useful
 * without committing to a chart library. Single component swap when
 * the v2 charts BRD lands.
 *
 * Each row: [date | count | css-bar]. Stacked variants render two
 * bars with two colors (pro on top of free).
 *
 * Spec: BRD-admin-ui-design §3.4.
 */

import { tokens } from '@/styles/tokens';

export interface SparklinePoint {
  date: string;
  pro_value: number;
  free_value: number;
}

export interface TabularSparklineProps {
  title: string;
  points: SparklinePoint[];
  /** How to render the value column: integer count or USD spend. */
  format: 'count' | 'usd';
}

export function TabularSparkline({ title, points, format }: TabularSparklineProps) {
  const max = Math.max(1, ...points.map((p) => p.pro_value + p.free_value));
  const fmt = (n: number) =>
    format === 'usd' ? `$${n.toFixed(2)}` : Intl.NumberFormat().format(Math.round(n));

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <h3 style={{ fontSize: 12, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        {title}
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: tokens.font.mono, fontSize: 11 }}>
        <tbody>
          {points.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: '8px 0', color: tokens.text.muted }}>
                No activity in the window.
              </td>
            </tr>
          ) : (
            points.map((p) => {
              const total = p.pro_value + p.free_value;
              const proPct  = (p.pro_value  / max) * 100;
              const freePct = (p.free_value / max) * 100;
              return (
                <tr key={p.date}>
                  <td style={{ color: tokens.text.muted, padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>
                    {p.date}
                  </td>
                  <td style={{ width: '100%', padding: '2px 8px 2px 0' }}>
                    <div style={{ display: 'flex', height: 10, background: tokens.bg.surface }}>
                      {p.pro_value > 0 && (
                        <div style={{ width: `${proPct}%`, background: tokens.tier.verified }} />
                      )}
                      {p.free_value > 0 && (
                        <div style={{ width: `${freePct}%`, background: tokens.text.muted }} />
                      )}
                    </div>
                  </td>
                  <td style={{ color: tokens.text.primary, textAlign: 'right', padding: '2px 0', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(total)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: 10, color: tokens.text.muted, display: 'flex', gap: 12 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: tokens.tier.verified, marginRight: 4, verticalAlign: 'middle' }} /> pro</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: tokens.text.muted,    marginRight: 4, verticalAlign: 'middle' }} /> free</span>
      </div>
    </div>
  );
}
