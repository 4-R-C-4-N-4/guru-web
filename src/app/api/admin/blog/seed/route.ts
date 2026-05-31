/**
 * POST /api/admin/blog/seed — queue a custom (operator-authored) blog seed.
 *
 * First MUTATING /api/admin/* endpoint (IMPL Hard rule 4): gates on
 * requireAdmin(), 404 on failure (never 401/403). Validates the pair +
 * model + scope, then inserts a 'queued' row with seed_kind='custom'.
 *
 * Spec: docs/blog-pipeline/BRD-blog-pipeline.md §5.4, IMPL T4.
 */

import { requireAdmin } from '@/lib/admin';
import { isCuratedSlug } from '@/lib/curated-models';
import { insertSeed } from '@/lib/admin-blog';

const SCOPE_MODES = new Set(['all', 'whitelist', 'blacklist']);

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export async function POST(req: Request) {
  const result = await requireAdmin();
  if (result instanceof Response) return result;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // concept_ids must be exactly two non-empty strings — the parallel.
  const conceptIds = strArray(b.concept_ids);
  if (conceptIds.length !== 2 || conceptIds.some(id => !id.trim())) {
    return Response.json(
      { error: 'concept_ids must be exactly two concept ids' },
      { status: 400 },
    );
  }

  // model must be a current curated slug.
  if (typeof b.model !== 'string' || !isCuratedSlug(b.model)) {
    return Response.json({ error: 'unknown model slug' }, { status: 400 });
  }

  // scope_mode must be one of the allowed modes (default 'all').
  const scopeMode = typeof b.scope_mode === 'string' ? b.scope_mode : 'all';
  if (!SCOPE_MODES.has(scopeMode)) {
    return Response.json({ error: 'invalid scope_mode' }, { status: 400 });
  }

  const angle =
    typeof b.angle === 'string' && b.angle.trim() ? b.angle.trim() : null;

  const row = await insertSeed({
    concept_ids: conceptIds,
    angle,
    model: b.model,
    scope_mode: scopeMode,
    blocked_traditions: strArray(b.blocked_traditions),
    blocked_texts: strArray(b.blocked_texts),
    whitelisted_traditions: strArray(b.whitelisted_traditions),
    whitelisted_texts: strArray(b.whitelisted_texts),
    created_by: result.email,
  });

  return Response.json(row, { status: 201 });
}
