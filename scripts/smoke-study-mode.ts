/**
 * scripts/smoke-study-mode.ts
 *
 * Real-flow smoke for study mode (Phase W) against a live v4 corpus:
 * the app's own retrieve('study') → getDossierForText → buildStudyPrompt
 * modules, real ollama embeddings, no mocks. Run: npx tsx scripts/smoke-study-mode.ts
 */

import 'dotenv/config';
import { retrieve, summarySearch } from '../src/lib/retriever';
import { getDossierForText } from '../src/lib/dossier';
import { buildStudyPrompt, buildPrompt } from '../src/lib/prompt';

import type { UserPreferences } from '../src/lib/types';

const OPEN: UserPreferences = {
  scopeMode: 'all', blockedTraditions: [], blockedTexts: [],
  whitelistedTraditions: [], whitelistedTexts: [],
} as unknown as UserPreferences;

function fail(msg: string): never { console.error(`✗ ${msg}`); process.exit(1); }
function ok(msg: string) { console.log(`✓ ${msg}`); }

async function main() {
  // 1. Study retrieval on a grouped multi-member work (pin via member text)
  const chunks = await retrieve('who is Yahya and how does he baptize', OPEN, 10, 'study', 'gnostic-john-baptizer-2');
  const summaries = chunks.filter(c => c.source === 'summary');
  const primaries = chunks.filter(c => c.source !== 'summary');
  if (chunks.length === 0) fail('study retrieve returned nothing');
  if (summaries.length === 0) fail('no summary rows in study candidates');
  if (summaries.some(s => s.tier !== 'summary')) fail('summary row lost its tier');
  if (primaries.some(p => !p.text_id.startsWith('gnostic-john-baptizer'))) fail('pin leaked: non-member primary chunk');
  ok(`study retrieve: ${chunks.length} rows (${primaries.length} chunks + ${summaries.length} summaries), pin held`);

  // 2. Dossier fetch through a member text (PK-shaped, themes resolved)
  const dossier = await getDossierForText('gnostic-john-baptizer-2');
  if (!dossier) fail('dossier fetch returned null for a covered work');
  if (!dossier.structure.length) fail('dossier has no structure entries');
  if (dossier.themes.some(t => t.startsWith('concept.'))) console.warn(`  (unresolved theme ids: ${dossier.themes.filter(t => t.startsWith('concept.')).join(', ')})`);
  ok(`dossier: ${dossier.work_label} — ${dossier.structure.length} TOC entries, ${dossier.themes.length} themes (${dossier.themes.slice(0,3).join(', ')})`);

  // 3. Prompt assembly with the real dossier + real chunks
  const prompt = buildStudyPrompt('who is Yahya and how does he baptize', chunks, dossier, OPEN, 'pro', 0);
  if (!prompt.includes('WORK DOSSIER')) fail('prompt missing dossier block');
  if (prompt.indexOf('WORK DOSSIER') > prompt.indexOf('SOURCE PASSAGES')) fail('dossier block after passages');
  if (!prompt.includes('TIER: summary')) fail('no summary passage rendered in prompt');
  ok(`study prompt: ${prompt.length} chars, dossier block + ${(prompt.match(/^\[\d+\]/gm) ?? []).length} passages`);

  // 4. The W0 scope-regression case: block an UNRELATED text, multi-member L2 must survive
  // Leg-level check (ranking-independent): the NULL-text_id L2 must be
  // REACHABLE under an unrelated text blacklist — the exact W0 failure case.
  const legRows = await summarySearch('the whole teaching of this work', {
    ...OPEN, scopeMode: 'blacklist', blockedTexts: ['kalevala'],
  } as UserPreferences, 50);
  const l2 = legRows.find(c => c.id === 'sum:gnostic-john-baptizer');
  if (!l2) fail('W0 regression: multi-member L2 dropped under unrelated blacklist');
  const blocked = await summarySearch('runes', {
    ...OPEN, scopeMode: 'blacklist', blockedTexts: ['kalevala'],
  } as UserPreferences, 700);
  if (blocked.some(c => c.text_id === 'kalevala')) fail('blacklist failed to block the target work');
  ok(`scope regression: NULL-text_id L2 reachable under unrelated blacklist; kalevala itself correctly blocked (${legRows.length} vs ${blocked.length} rows)`);

  // 5. Chat-mode non-regression: same query, no summaries, no pin
  const chat = await retrieve('who is Yahya and how does he baptize', OPEN, 10);
  if (chat.some(c => c.source === 'summary')) fail('chat mode leaked summary rows');
  const chatPrompt = buildPrompt('who is Yahya', chat, OPEN, 'pro', 0);
  if (chatPrompt.includes('WORK DOSSIER')) fail('chat prompt has dossier block');
  ok(`chat non-regression: ${chat.length} rows, zero summaries, no dossier block`);

  // 6. A second study work: single-text work with per-tradition cap lifted
  const plato = await retrieve('what is the allegory of the cave about', OPEN, 8, 'study', 'plato-republic-7-0');
  const platoTrads = new Set(plato.map(c => c.tradition));
  if (plato.length <= 3 && platoTrads.size === 1) fail(`cap not lifted: only ${plato.length} rows for single-tradition work`);
  ok(`plato study: ${plato.length} rows from ${platoTrads.size} tradition(s) — cap lifted (${plato.filter(c=>c.source==='summary').length} summaries)`);

  console.log('\nALL SMOKE CHECKS PASSED');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
