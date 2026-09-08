/**
 * src/app/(admin)/admin/guests/page.tsx
 *
 * /admin/guests — visibility on anonymous first-question visitors who have
 * NOT converted (todo:85125f9e). Each row is a guest question the operator
 * paid for: who asked (ip-name pseudonym + IP), what they asked and what
 * Guru answered (query in / answer out), which model, and the cost. A guest
 * who signs up is adopted into a normal free query and drops off this list.
 */

import { requireAdmin } from '@/lib/admin';
import { notFound } from 'next/navigation';
import { fetchGuestQueries, fetchGuestCount } from '@/lib/admin-queries';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  color: tokens.text.muted,
  fontFamily: tokens.font.mono,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: `1px solid ${tokens.border.subtle}`,
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'top',
  borderBottom: `1px solid ${tokens.border.subtle}`,
  fontSize: 12,
};

function usd(n: number | null): string {
  return n === null ? '—' : `$${n.toFixed(4)}`;
}

export default async function AdminGuestsPage() {
  const result = await requireAdmin();
  if (result instanceof Response) notFound();

  const [rows, total] = await Promise.all([fetchGuestQueries(200), fetchGuestCount()]);

  return (
    <>
      <h1 style={{ fontSize: 18, marginBottom: 6, color: tokens.text.primary }}>Guests</h1>
      <p style={{ fontSize: 12, color: tokens.text.muted, marginBottom: 20, fontFamily: tokens.font.mono }}>
        {total} unconverted anonymous {total === 1 ? 'question' : 'questions'} · newest first
        {rows.length < total ? ` · showing ${rows.length}` : ''}
      </p>

      {rows.length === 0 ? (
        <p style={{ color: tokens.text.muted }}>No unconverted guest questions.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>When</th>
              <th style={th}>Guest</th>
              <th style={th}>Question / Answer</th>
              <th style={th}>Model</th>
              <th style={{ ...th, textAlign: 'right' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, whiteSpace: 'nowrap', color: tokens.text.muted, fontFamily: tokens.font.mono, fontSize: 11 }}>
                  {new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  <div style={{ color: tokens.text.primary }}>{r.ip_name ?? '—'}</div>
                  <div style={{ color: tokens.text.muted, fontFamily: tokens.font.mono, fontSize: 10 }}>{r.guest_ip ?? '—'}</div>
                </td>
                <td style={{ ...td, maxWidth: 620 }}>
                  <div style={{ color: tokens.text.primary, marginBottom: 6 }}>{r.query_text}</div>
                  <details>
                    <summary style={{ cursor: 'pointer', color: tokens.text.link, fontFamily: tokens.font.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Answer ({r.output_tokens ?? '—'} tok)
                    </summary>
                    <div style={{ color: tokens.text.muted, fontSize: 12, lineHeight: 1.5, marginTop: 6, whiteSpace: 'pre-wrap' }}>
                      {r.response_text}
                    </div>
                  </details>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: tokens.text.muted, fontFamily: tokens.font.mono, fontSize: 11 }}>
                  {r.model_used ?? '—'}
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: tokens.font.mono, fontVariantNumeric: 'tabular-nums' }}>
                  {usd(r.cost_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
