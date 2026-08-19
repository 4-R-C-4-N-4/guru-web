/**
 * src/__tests__/social-metadata.test.ts
 *
 * todo:7cf30162 — regression coverage for blank social preview cards. Before
 * this, no route emitted og:image or a twitter:card tag, so shared guru-ai.org
 * links rendered X's blank placeholder. These pin the sitewide social defaults
 * (spread into the root metadata) and the presence + shape of the static card
 * asset they point at.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { OG_IMAGE, SOCIAL_METADATA } from '@/lib/site';

const publicOg = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/og.png',
);

describe('social card metadata', () => {
  it('exposes an og:image via openGraph', () => {
    expect(SOCIAL_METADATA.openGraph.images).toContainEqual(OG_IMAGE);
    expect(OG_IMAGE.url).toBe('/og.png');
    expect(OG_IMAGE.width).toBe(1200);
    expect(OG_IMAGE.height).toBe(630);
  });

  it('requests the large summary twitter card with an image', () => {
    // X reads twitter:image preferentially; this block is overridden by no
    // page, so it is what gives openGraph-overriding routes a real card.
    expect(SOCIAL_METADATA.twitter.card).toBe('summary_large_image');
    expect(SOCIAL_METADATA.twitter.images).toContain(OG_IMAGE.url);
  });

  it('ships the referenced static card asset as a 1200x630 PNG', () => {
    expect(existsSync(publicOg)).toBe(true);
    const buf = readFileSync(publicOg);
    // PNG signature
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    // IHDR width/height are big-endian uint32 at byte offsets 16 and 20
    expect(buf.readUInt32BE(16)).toBe(OG_IMAGE.width);
    expect(buf.readUInt32BE(20)).toBe(OG_IMAGE.height);
  });
});
