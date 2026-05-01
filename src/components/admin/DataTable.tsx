/**
 * src/components/admin/DataTable.tsx
 *
 * Native <table> with URL-driven sort + pagination + optional CSV
 * download link in the footer.
 *
 * Spec: BRD-admin-ui-design §3.3, §1.3.
 *
 * Sort cycle: asc → desc → unset → asc. Sort and page state live in
 * URL params (`sort`, `dir`, `page`); the parent passes them in and
 * builds the column links. Keeping the link-building here would mean
 * either capturing useSearchParams (forces 'use client' on the whole
 * page) or duplicating it into every consumer; each consumer page
 * already reads the params for filters, so it builds the column links
 * too. The component just renders.
 */

import Link from 'next/link';
import { tokens } from '@/styles/tokens';

export interface Column<T> {
  /** Column key — also the sort key sent to the server. */
  key: string;
  label: string;
  /** Server-side sortable. Default false. */
  sortable?: boolean;
  /** Render the cell. */
  render: (row: T) => React.ReactNode;
  /** Right-align numeric columns. */
  align?: 'left' | 'right';
}

export interface DataTableProps<T> {
  columns:    Column<T>[];
  rows:       T[];
  rowKey:     (row: T) => string;
  /** URL where each row navigates on click. */
  rowHref?:   (row: T) => string;
  /** Empty-state copy when rows is empty. Single line, factual (BRD §5.3). */
  emptyMessage: string;

  /** Sort state. */
  sort:    { by: string | null; dir: 'asc' | 'desc' };
  /** Build a URL for a given column header click. The page owns its
   * URL state, so it's responsible for constructing the link. */
  sortHref: (column: string, dir: 'asc' | 'desc') => string;

  /** Pagination state + total. Ignored when total <= pageSize. */
  page?:     number;
  pageSize?: number;
  total?:    number;
  pageHref?: (page: number) => string;

  /** Optional CSV download link. */
  csvHref?: string;
  csvLabel?: string;
}

const cellPad = '6px 8px';

export function DataTable<T>({
  columns, rows, rowKey, rowHref, emptyMessage,
  sort, sortHref,
  page = 0, pageSize = 0, total = 0, pageHref,
  csvHref, csvLabel = 'Download CSV',
}: DataTableProps<T>) {
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((col) => {
              const isSorted = sort.by === col.key;
              const nextDir: 'asc' | 'desc' = isSorted && sort.dir === 'asc' ? 'desc' : 'asc';
              const indicator = isSorted ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
              const headStyle: React.CSSProperties = {
                textAlign: col.align ?? 'left',
                padding: cellPad,
                borderBottom: `1px solid ${tokens.border.subtle}`,
                color: tokens.text.muted,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontSize: 11,
                fontWeight: 500,
                position: 'sticky',
                top: 0,
                background: tokens.bg.deep,
              };
              return (
                <th key={col.key} style={headStyle}>
                  {col.sortable ? (
                    <Link
                      href={sortHref(col.key, nextDir)}
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      {col.label}{indicator}
                    </Link>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: cellPad, color: tokens.text.muted }}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row);
              const href = rowHref?.(row);
              return (
                <tr key={key}>
                  {columns.map((col) => {
                    const cellStyle: React.CSSProperties = {
                      padding: cellPad,
                      borderBottom: `1px solid ${tokens.border.subtle}`,
                      textAlign: col.align ?? 'left',
                      fontVariantNumeric: 'tabular-nums',
                    };
                    const content = col.render(row);
                    return (
                      <td key={col.key} style={cellStyle}>
                        {href && col.key === columns[0]?.key ? (
                          <Link href={href} style={{ color: tokens.text.link, textDecoration: 'none' }}>
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {(total > pageSize && pageHref) || csvHref ? (
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            justifyContent: 'space-between',
            color: tokens.text.muted,
            fontSize: 11,
          }}
        >
          <div>
            {pageHref && total > 0 ? (
              <Pagination page={page} pageSize={pageSize} total={total} pageHref={pageHref} />
            ) : null}
          </div>
          {csvHref ? (
            <a href={csvHref} style={{ color: tokens.text.link, textDecoration: 'none' }}>
              {csvLabel}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Pagination({
  page, pageSize, total, pageHref,
}: {
  page: number; pageSize: number; total: number;
  pageHref: (p: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to   = Math.min(total, (page + 1) * pageSize);
  return (
    <span>
      {from}–{to} of {total}
      {' '}·{' '}
      {page > 0 ? (
        <Link href={pageHref(page - 1)} style={{ color: tokens.text.link, textDecoration: 'none' }}>
          prev
        </Link>
      ) : <span style={{ opacity: 0.4 }}>prev</span>}
      {' '}
      {page < pages - 1 ? (
        <Link href={pageHref(page + 1)} style={{ color: tokens.text.link, textDecoration: 'none' }}>
          next
        </Link>
      ) : <span style={{ opacity: 0.4 }}>next</span>}
    </span>
  );
}
