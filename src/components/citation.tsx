'use client';

import Link from 'next/link';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { citationHref } from '@/lib/read-path';

interface CitationProps {
  /** Chunk or summary-node id. When present and resolvable, the card links
   *  into the /read source library; absent (parsed-block fallbacks, legacy
   *  snapshots) the card renders exactly as before — unlinked. */
  id?: string;
  tradition: string;
  text: string;
  section: string;
  quote?: string;
  tier: 'verified' | 'proposed' | 'inferred' | 'summary';
}

const TIER_SYMBOL = { verified: '◆', proposed: '◇', inferred: '○', summary: '§' } as const;

export default function Citation({ id, tradition, text, section, quote, tier }: CitationProps) {
  const mobile = useIsMobile();
  const color  = tokens.tradition[tradition.toLowerCase() as keyof typeof tokens.tradition] ?? tokens.text.secondary;
  const symbol = TIER_SYMBOL[tier] ?? '○';
  const tierColor = tokens.tier[tier] ?? tokens.tier.inferred;
  const href = citationHref(id);

  const card = (
    <div style={{
      borderLeft: `2px solid ${color}`,
      padding: mobile ? '6px 10px' : '8px 12px',
      margin: '6px 0',
      background: `${color}08`,
    }}>
      <div style={{
        fontFamily: tokens.font.mono, fontSize: mobile ? 10 : 11, color: tokens.text.muted,
        marginBottom: 4, display: 'flex', alignItems: 'center', gap: mobile ? 4 : 6, flexWrap: 'wrap',
      }}>
        <span style={{ color: tierColor }}>{symbol}</span>
        <span style={{ color }}>{tradition}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{text}</span>
        <span style={{ opacity: 0.4 }}>|</span>
        <span>{section}</span>
        {href && <span style={{ marginLeft: 'auto', color: tokens.text.link }}>read →</span>}
      </div>
      {quote && (
        <div style={{
          fontFamily: tokens.font.display, fontSize: mobile ? 13 : 14,
          color: tokens.text.primary, fontStyle: 'italic', lineHeight: 1.5,
        }}>&ldquo;{quote}&rdquo;</div>
      )}
    </div>
  );

  if (!href) return card;
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }} title="Read in the source library">
      {card}
    </Link>
  );
}
