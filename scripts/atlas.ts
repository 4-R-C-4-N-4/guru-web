/**
 * scripts/atlas.ts
 *
 * Generate a "State of the Atlas" edition — the recurring, grounded
 * corpus-analysis essay (todo:526a20c3). Run this at release time; it writes a
 * DRAFT for you to review and publish via /admin/blog.
 *
 * Usage:
 *   npm run atlas                  # generate a draft edition with the default model
 *   npm run atlas -- --model=anthropic
 *   npm run atlas -- --force       # mint one even if a draft is already in flight
 *   npm run atlas -- --dry-run     # compute + print the snapshot only (no LLM, no write)
 *   npm run atlas -- --print-prompt  # compute + print the full model prompt (no LLM, no write)
 */

import 'dotenv/config';
import { computeAtlasSnapshot } from '../src/lib/atlas';
import { generateAtlasEdition } from '../src/lib/atlas-generate';
import { getAtlasSystemPrompt, buildAtlasPrompt } from '../src/lib/prompt';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function opt(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

function printSnapshotSummary(s: Awaited<ReturnType<typeof computeAtlasSnapshot>>) {
  const h = s.headline;
  console.log(`\n  Corpus (schema v${s.schemaVersion}, as of ${s.generatedAt}):`);
  console.log(`    ${h.traditions} traditions · ${h.concepts} concepts / ${h.families} families`);
  console.log(`    ${h.parallelsTotal} parallels (median weight ${h.parallelsMedianWeight}, p90 ${h.parallelsP90Weight}) · ${h.contrasts} contrasts`);
  console.log(`  Top pairs (by median weight):`);
  for (const m of s.traditionMatrix.slice(0, 5)) console.log(`    ${m.a} ↔ ${m.b}: ${m.parallels} parallels, median weight ${m.medianWeight}`);
  console.log(`  Bridge families:`);
  for (const f of s.familyBridges.slice(0, 5)) console.log(`    ${f.label} (${f.domain}): ${f.traditions} traditions, ${f.concepts} concepts`);
  console.log(`  Bridge concepts:`);
  for (const b of s.bridgeConcepts.slice(0, 5)) console.log(`    ${b.label}${b.family ? ` [${b.family}]` : ''}: ${b.traditions} traditions`);
  console.log(`  Long-range cases: ${s.longRangeCases.map(l => `${l.a}↔${l.b} (${l.parallels})`).join(', ') || 'none'}`);
  const dl = s.documentLayer;
  console.log(`  Document layer: ${dl.works} works · ${dl.dossiers} dossiers · ${dl.summaryNodesL1} L1 + ${dl.summaryNodesL2} L2 summaries`);
  console.log(`  Dossier capsules for cited works: ${s.dossierCapsules.map(c => c.work_label).join(', ') || 'none'}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (check .env)');
  const generatedAt = new Date().toISOString();

  if (flag('print-prompt')) {
    console.log('atlas: printing the full model prompt (no model call, no write).');
    const snapshot = await computeAtlasSnapshot(generatedAt);
    console.log('\n════ SYSTEM ════\n');
    console.log(getAtlasSystemPrompt());
    console.log('\n════ USER ════\n');
    console.log(buildAtlasPrompt(snapshot));
    return;
  }

  if (flag('dry-run')) {
    console.log('atlas: dry run — computing snapshot only (no model call, no write).');
    const snapshot = await computeAtlasSnapshot(generatedAt);
    printSnapshotSummary(snapshot);
    console.log('\nDry run complete. Re-run without --dry-run to generate a draft edition.');
    return;
  }

  console.log('atlas: generating a State of the Atlas edition (draft)…');
  const res = await generateAtlasEdition({ generatedAt, model: opt('model'), force: flag('force') });
  printSnapshotSummary(res.snapshot);
  console.log(`\n✓ Draft edition №${res.editionNo} written.`);
  console.log(`    id:    ${res.id}`);
  console.log(`    slug:  ${res.slug}`);
  console.log(`    title: ${res.title}`);
  console.log(`    cost:  ${res.costUsd != null ? `$${res.costUsd.toFixed(4)}` : 'n/a'}`);
  console.log(`\nReview it in /admin/blog, then publish. It will appear at /blog/${res.slug} and /atlas.`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\natlas failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
