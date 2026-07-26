/**
 * src/__tests__/canonicals.test.ts
 *
 * Source-level guard (todo:17621cef): every indexable public page must
 * declare alternates.canonical. The live-site audit (2026-07-25) found 0/113
 * sampled pages emitted rel="canonical" — with www.guru-ai.org resolving and
 * any future query-param growth, that leaves duplicate-URL resolution
 * entirely to the crawler. metadataBase in the root layout makes these
 * relative paths absolute. Summary and share pages are deliberately absent:
 * they are robots-noindexed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const page = (rel: string) => readFileSync(resolve(__dirname, '../app', rel), 'utf8');

const INDEXABLE_PUBLIC_PAGES = [
  'page.tsx',
  'blog/page.tsx',
  'blog/[slug]/page.tsx',
  'atlas/page.tsx',
  'read/page.tsx',
  'read/search/page.tsx',
  'read/concepts/page.tsx',
  'read/concepts/[slug]/page.tsx',
  'read/[tradition]/page.tsx',
  'read/[tradition]/[textId]/page.tsx',
  'read/[tradition]/[textId]/[n]/page.tsx',
];

describe('canonical URLs on public pages (todo:17621cef)', () => {
  it.each(INDEXABLE_PUBLIC_PAGES)('%s declares alternates.canonical', (rel) => {
    expect(page(rel)).toMatch(/alternates:\s*\{\s*canonical:/);
  });

  it('the chunk page canonicalizes from the chunk id, not request params', () => {
    expect(page('read/[tradition]/[textId]/[n]/page.tsx'))
      .toMatch(/canonical:\s*chunkIdToPath\(chunk\.id\)/);
  });
});
