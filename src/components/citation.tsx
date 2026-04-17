'use client';

import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';

interface CitationProps {
  tradition: string;
  text: string;
  section: string;
  quote?: string;
  tier: 'verified' | 'proposed' | 'inferred';
}

const TIER_SYMBOL = { verified: '◆', proposed: '◇', inferred: '○' } as const;

export default function Citation({ tradition, text, section, quote, tier }: CitationProps) {
  const mobile = useIsMobile();
  const color  = tokens.tradition[tradition.toLowerCase() as keyof typeof tokens.tradition] ?? tokens.text.secondary;
  const symbol = TIER_SYMBOL[tier] ?? '○';
  const tierColor = tokens.tier[tier] ?? tokens.tier.inferred;

  return (
    <div style={{
      borderLeft: `2px solid ${color}`,
      padding: mobile ? '6px 10px' : '8px 12px',
      margin: '6px 0',
      background: `${color}08`,
    }}>
      <div style={{
        fontFamily: tokens.font.mono, fontSize: mobile ? 9 : 10, color: tokens.text.muted,
        marginBottom: 4, display: 'flex', alignItems: 'center', gap: mobile ? 4 : 6, flexWrap: 'wrap',
      }}>
        <span style={{ color: tierColor }}>{symbol}</span>
        <span style={{ color }}>{tradition}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{text}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{section}</span>
      </div>
      {quote && (
        <div style={{
          fontFamily: tokens.font.display, fontSize: mobile ? 13 : 14,
          color: tokens.text.primary, fontStyle: 'italic', lineHeight: 1.5,
        }}>&ldquo;{quote}&rdquo;</div>
      )}
    </div>
  );
}
