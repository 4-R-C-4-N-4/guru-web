/**
 * src/app/api/admin/sessions/[id]/queries.csv/route.ts
 *
 * GET /api/admin/sessions/:id/queries.csv — streaming CSV of every
 * query in a session, including the model_pricing row used at the
 * time of each query.
 *
 * Spec: BRD-admin-ui §1.18.
 */

import { requireAdmin } from '@/lib/admin';
import { getSessionDeepDive } from '@/lib/admin-queries';
import { streamingCsv, type CsvCell } from '@/components/admin/csv';

const HEADER = [
  'query_id', 'created_at', 'model_used', 'tier_used',
  'input_tokens', 'output_tokens', 'cached_input_tokens',
  'cost_usd',
  'price_input_per_mtok', 'price_output_per_mtok', 'price_cached_input_per_mtok',
  'pricing_effective_from',
  'query_text', 'response_text',
];

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  const { id } = await ctx.params;
  const data = await getSessionDeepDive(id);
  if (!data) return new Response(null, { status: 404 });

  return streamingCsv(
    `session-${id}-queries-${new Date().toISOString().slice(0, 10)}.csv`,
    HEADER,
    (async function* () {
      yield data.queries.map((q) => [
        q.id,
        q.created_at,
        q.model_used,
        q.tier_used,
        q.input_tokens ?? 0,
        q.output_tokens ?? 0,
        q.cached_input_tokens,
        q.cost_usd ?? 0,
        q.pricing_input_per_mtok ?? '',
        q.pricing_output_per_mtok ?? '',
        q.pricing_cached_input_per_mtok ?? '',
        q.pricing_effective_from ?? '',
        q.query_text,
        q.response_text,
      ] satisfies CsvCell[]);
    })(),
  );
}
