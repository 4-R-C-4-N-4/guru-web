/**
 * src/components/admin/csv.ts
 *
 * Minimal streaming CSV writer used by every /api/admin/*.csv route.
 *
 * Spec: BRD-admin-ui §1.18.
 *
 * Design:
 *   - The route hands us a header row and an async generator of data
 *     rows; we emit a ReadableStream that yields the header chunk
 *     first and each batch of data rows as a separate chunk. No row
 *     materialisation across the whole result set.
 *   - Quoting follows RFC 4180: any field containing a comma, quote,
 *     CR, or LF is wrapped in double quotes with internal quotes
 *     doubled. This is the smallest correct quoter.
 *
 * The route can either drive this with a paginated SELECT loop
 * (current default for our scale) or, if a route ever needs it, swap
 * in pg-cursor without touching the streaming logic here.
 */

export type CsvCell = string | number | null | undefined;

export function csvEscape(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvLine(cells: CsvCell[]): string {
  return cells.map(csvEscape).join(',') + '\r\n';
}

/**
 * Build a Response wrapping a ReadableStream that emits:
 *   - the header line as the first chunk
 *   - subsequent chunks of N rows each, drawn from the async iterable
 *
 * The async iterable yields BATCHES of rows (CsvCell[][]) rather than
 * individual rows so a paginated SELECT (the typical impl) can return
 * 1000 rows in one chunk without an extra layer of yielding.
 */
export function streamingCsv(
  filename: string,
  header: string[],
  batches: AsyncIterable<CsvCell[][]>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(csvLine(header)));
        for await (const batch of batches) {
          if (batch.length === 0) continue;
          let chunk = '';
          for (const row of batch) chunk += csvLine(row);
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  });
}
