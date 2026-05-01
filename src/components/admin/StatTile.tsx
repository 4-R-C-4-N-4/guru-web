/**
 * src/components/admin/StatTile.tsx
 *
 * Compact label + value + optional delta. Used in stat-tile rows on
 * the overview, users-list, and deep-dive headers.
 *
 * Spec: BRD-admin-ui-design §3.2.
 *
 *   | Spend MTD                |
 *   | $24.13                   |
 *   | +$3.20 vs last month     |
 *
 * Three text sizes, three colors. No icons, no border, no background.
 * Spacing alone separates tiles. Sign-only color on the delta line.
 */

import { tokens } from '@/styles/tokens';

export interface StatTileProps {
  label: string;
  value: string;
  /** Optional delta line. positive=true → muted green, false → muted red, null → muted text. */
  delta?: { text: string; positive: boolean | null } | null;
}

export function StatTile({ label, value, delta }: StatTileProps) {
  const deltaColor = !delta
    ? tokens.text.muted
    : delta.positive === null
      ? tokens.text.muted
      : delta.positive
        ? '#7aa37a'  // muted green
        : '#a37a7a'; // muted red

  return (
    <div style={{ minWidth: 160, padding: '4px 16px 4px 0' }}>
      <div style={{ fontSize: 11, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, color: tokens.text.primary, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, margin: '2px 0' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: deltaColor, minHeight: 14, fontVariantNumeric: 'tabular-nums' }}>
        {delta?.text ?? ''}
      </div>
    </div>
  );
}
