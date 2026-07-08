/**
 * scripts/inspect-study-prompts.ts
 *
 * Capture real study-mode runs for qualitative review: retrieved candidates
 * (with scores), the rendered dossier block, and the assembled prompt.
 * Writes JSON to the path given as argv[2].
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { retrieve } from '../src/lib/retriever';
import { getDossierForText } from '../src/lib/dossier';
import { buildStudyPrompt, formatDossier } from '../src/lib/prompt';
import type { UserPreferences } from '../src/lib/types';

const OPEN: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [],
} as unknown as UserPreferences;

const CASES = [
  { label: 'grouped work, narrative question',
    textId: 'gnostic-john-baptizer-2', query: 'who is Yahya and how does he baptize' },
  { label: 'single text, famous passage',
    textId: 'plato-republic-7-0', query: 'what does the allegory of the cave say about education' },
  { label: 'mythic epic, whole-work question',
    textId: 'enuma-elish', query: 'how does Marduk defeat Tiamat and what does he create from her body' },
];

async function main() {
  const out = [];
  for (const c of CASES) {
    const chunks = await retrieve(c.query, OPEN, 10, 'study', c.textId);
    const dossier = await getDossierForText(c.textId);
    const prompt = buildStudyPrompt(c.query, chunks, dossier, OPEN, 'pro', 0);
    out.push({
      ...c,
      work: dossier?.work_label,
      candidates: chunks.map(ch => ({
        id: ch.id, source: ch.source, tier: ch.tier, section: ch.section,
        distance: ch.distance != null ? Number(ch.distance.toFixed(4)) : null,
        opening: ch.body.slice(0, 220),
      })),
      dossierBlock: dossier ? formatDossier(dossier) : null,
      promptChars: prompt.length,
      prompt,
    });
    console.log(`${c.textId}: ${chunks.length} rows, prompt ${prompt.length} chars`);
  }
  writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
