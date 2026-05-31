/**
 * POST /api/admin/blog/seed — queue a custom (operator-authored) blog seed.
 *
 * First MUTATING /api/admin/* endpoint (IMPL Hard rule 4): gates on
 * requireAdmin(), 404 on failure (never 401/403). Accepts EITHER a free-text
 * `topic` (mode A) OR a two-element `concept_ids` pair (mode B) — exactly one,
 * enforced here — plus model + scope, then inserts a 'queued' seed_kind='custom'
 * row.
 *
 * Spec: docs/blog-pipeline/BRD-blog-pipeline.md §5.4, IMPL T4, todo:bf1c07fb.
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

  // Seeding mode: exactly one of topic (free text) or a two-element concept
  // pair. Topic wins if both are somehow present.
  const topic =
    typeof b.topic === 'string' && b.topic.trim() ? b.topic.trim() : null;
  const conceptIds = strArray(b.concept_ids).filter(id => id.trim());
  const hasPair = conceptIds.length === 2;

  if (!topic && !hasPair) {
    return Response.json(
      { error: 'provide either a non-empty topic or exactly two concept_ids' },
      { status: 400 },
    );
  }
  if (!topic && conceptIds.length !== 2) {
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
    topic,
    concept_ids: topic ? null : conceptIds,
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
