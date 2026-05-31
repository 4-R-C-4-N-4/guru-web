/**
 * src/app/api/hierarchy/route.ts
 *
 * GET /api/hierarchy — the domain → family → concept tree for the browse and
 * query-expansion UI (todo:60bd563f; design §8).
 *
 * Assembled from the real `concept_families` + `concepts` tables (the
 * actually-navigable surface), so the UI cannot offer a family or concept the
 * corpus doesn't contain. An empty tree is meaningful: it means the corpus has
 * not been restored. The client must NOT substitute a fallback — surface the
 * empty/error state so the broken upstream is visible.
 *
 * Concepts are placed under their PRIMARY family (`concepts.family_id`), so each
 * appears once in the browse tree; secondary memberships are a retrieval-only
 * concern (read side ignores is_primary) and not part of this navigation shape.
 */

import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
import type { DomainView, FamilyView } from '@/lib/types';

export async function GET() {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;

  const families = await query<{
    id: string;
    parent_id: string | null;
    label: string;
    definition: string;
  }>(
    `SELECT id, parent_id, label, definition FROM concept_families ORDER BY id`,
  );

  const concepts = await query<{
    id: string;
    label: string;
    definition: string | null;
    family_id: string | null;
  }>(
    `SELECT id, label, definition, family_id FROM concepts WHERE family_id IS NOT NULL ORDER BY label`,
  );

  // Domains are family rows with no parent; families point at their domain.
  const domains = new Map<string, DomainView>();
  const familyIndex = new Map<string, FamilyView>();

  for (const f of families) {
    if (f.parent_id === null) {
      domains.set(f.id, { id: f.id, label: f.label, definition: f.definition, families: [] });
    }
  }
  for (const f of families) {
    if (f.parent_id !== null) {
      const family: FamilyView = {
        id: f.id, label: f.label, definition: f.definition, domain: f.parent_id, concepts: [],
      };
      familyIndex.set(f.id, family);
      // A family whose domain row is missing is dropped rather than orphaned.
      domains.get(f.parent_id)?.families.push(family);
    }
  }
  for (const c of concepts) {
    const family = c.family_id ? familyIndex.get(c.family_id) : undefined;
    family?.concepts.push({
      id: c.id,
      label: c.label,
      definition: c.definition,
      family_id: c.family_id,
      family_label: family.label,
      domain: family.domain,
    });
  }

  return Response.json({ domains: Array.from(domains.values()) });
}
