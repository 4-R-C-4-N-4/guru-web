/**
 * src/lib/dossier.ts
 *
 * Study-mode dossier fetch (summary-phase-w.md §W5, W0 finding 1).
 * One PK-shaped query resolves any member text to its work's dossier via
 * texts.work_id; a second resolves theme concept ids to display labels.
 * Cacheable per session — the corpus is static between deploys.
 */

import { query, one } from './db';
import type { WorkDossier } from './types';

interface DossierRow {
  work_id: string;
  work_label: string;
  summary: string;
  context: string;
  structure: WorkDossier['structure'];
  key_figures: WorkDossier['key_figures'];
  key_terms: WorkDossier['key_terms'];
  themes: string[];
  reading_notes: string | null;
}

/**
 * Fetch the dossier for the work containing `textId`. Returns null when the
 * work has no dossier — the caller renders no block (W0 finding 4: missing
 * dossier is normal partial coverage, never an error).
 */
export async function getDossierForText(textId: string): Promise<WorkDossier | null> {
  const row = await one<DossierRow>(
    `SELECT d.work_id, w.label AS work_label, d.summary, d.context,
            d.structure, d.key_figures, d.key_terms, d.themes, d.reading_notes
     FROM texts t
     JOIN works w         ON w.id = t.work_id
     JOIN work_dossiers d ON d.work_id = w.id
     WHERE t.id = $1`,
    [textId]
  );
  if (!row) return null;

  // Resolve theme concept ids ('concept.cosmic_dualism') to display labels.
  // Unresolvable ids fall back to the id itself — formatDossier strips the
  // prefix for display, so a stale theme never breaks the block.
  let themes = row.themes ?? [];
  if (themes.length > 0) {
    const labels = await query<{ id: string; label: string }>(
      `SELECT id, label FROM concepts WHERE id = ANY($1::text[])`,
      [themes]
    );
    const byId = new Map(labels.map(l => [l.id, l.label]));
    themes = themes.map(t => byId.get(t) ?? t);
  }

  return { ...row, themes, reading_notes: row.reading_notes ?? null };
}
