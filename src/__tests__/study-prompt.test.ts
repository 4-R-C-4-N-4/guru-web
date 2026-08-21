/**
 * src/__tests__/study-prompt.test.ts
 *
 * W4 (todo:f785b269, summary-phase-w.md): dossier injection in study prompts.
 * Cases: with-dossier, without-dossier (no block, no placeholder), and
 * dossier + zero passages.
 */

import { describe, it, expect } from 'vitest';
import { buildStudyPrompt, formatDossier } from '@/lib/prompt';
import type { RetrievedChunk, UserPreferences, WorkDossier } from '@/lib/types';

const PREFS = {} as UserPreferences;

const DOSSIER: WorkDossier = {
  work_id: 'enuma-elish',
  work_label: 'Enuma Elish',
  summary: 'The Babylonian creation account in seven tablets.',
  context: 'Akkadian; tablets recovered from Nineveh. Translation per the curator notes.',
  structure: [
    { section_span: 'Part 1', title: 'Tiamat Prepares for War' },
    { section_span: 'Part 2', title: 'Marduk Slays Tiamat' },
  ],
  key_figures: [
    { name: 'Marduk', role: 'director of gods, dragon-slayer' },
    { name: 'Kingu', role: '', gloss: '' }, // junk entry — must be skipped
  ],
  key_terms: [{ term: 'Tablets of Destiny', gloss: 'emblem of supreme authority' }],
  themes: ['concept.cosmic_dualism', 'concept.divine_providence'],
  reading_notes: 'Read the tablets in order; the battle spans parts 1-2.',
};

const CHUNK: RetrievedChunk = {
  id: 'mesopotamian.enuma-elish.001', text_id: 'enuma-elish', tradition: 'mesopotamian',
  text_name: 'Enuma Elish', section: 'Part 1', translator: 'L.W. King', body: 'When on high...',
  token_count: 10, source: 'vector', tier: 'inferred',
} as RetrievedChunk;

const SUMMARY_CHUNK: RetrievedChunk = {
  ...CHUNK, id: 'sum:enuma-elish:part-1', source: 'summary', tier: 'summary',
  body: 'Tiamat prepares for war...',
};

describe('formatDossier', () => {
  const block = formatDossier(DOSSIER);

  it('carries the apparatus/citation rule in the header', () => {
    expect(block).toMatch(/study apparatus/);
    expect(block).toMatch(/Cite SOURCE PASSAGES, never this block/);
  });

  it('renders TOC lines, compact figures/terms, resolved theme labels', () => {
    expect(block).toContain('- Part 1 — Tiamat Prepares for War');
    expect(block).toContain('KEY FIGURES: Marduk (director of gods, dragon-slayer)');
    expect(block).not.toContain('Kingu');                    // empty entries skipped
    expect(block).toContain('Tablets of Destiny — emblem of supreme authority');
    expect(block).toContain('THEMES: cosmic dualism, divine providence');
    expect(block).toContain('READING NOTES:');
  });
});

describe('buildStudyPrompt', () => {
  it('prepends the dossier block before SOURCE PASSAGES', () => {
    const p = buildStudyPrompt('who slays Tiamat', [CHUNK, SUMMARY_CHUNK], DOSSIER, PREFS, 'pro');
    expect(p.indexOf('WORK DOSSIER')).toBeGreaterThanOrEqual(0);
    expect(p.indexOf('WORK DOSSIER')).toBeLessThan(p.indexOf('SOURCE PASSAGES'));
    expect(p).toMatch(/QUERY: who slays Tiamat$/);
    // summary passages are marked as generated apparatus, never as source text
    expect(p).toContain('GENERATED SUMMARY');
  });

  it('missing dossier → no block, no placeholder (W0 finding 4)', () => {
    const p = buildStudyPrompt('who slays Tiamat', [CHUNK], null, PREFS, 'pro');
    expect(p).not.toContain('WORK DOSSIER');
    expect(p).not.toMatch(/no dossier/i);
    expect(p).toContain('SOURCE PASSAGES:');
  });

  it('dossier + zero passages still renders both blocks sanely', () => {
    const p = buildStudyPrompt('anything', [], DOSSIER, PREFS, 'free');
    expect(p).toContain('WORK DOSSIER');
    expect(p).toContain('No source passages were found for this query.');
    expect(p).toMatch(/QUERY: anything$/);
  });

  it('never compresses the dossier (verbatim fields survive)', () => {
    const p = buildStudyPrompt('q', [CHUNK], DOSSIER, PREFS, 'free');
    expect(p).toContain(DOSSIER.summary);
    expect(p).toContain(DOSSIER.context);
  });
});

describe('citations legacy tier segment (todo:0f48f68a)', () => {
  it('parseCitationsBlock drops a stored TIER: summary segment without losing the entry', async () => {
    const { parseCitationsBlock } = await import('@/lib/citations');
    const raw = 'Answer body.\n\nCITATIONS:\n[mandaean | John-Book | Whole work | TIER: summary]';
    const { citations } = parseCitationsBlock(raw);
    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual({ tradition: 'mandaean', text: 'John-Book', section: 'Whole work' });
  });
});
