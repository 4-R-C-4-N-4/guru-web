/**
 * src/__tests__/share-button.test.tsx
 *
 * Share strip eligibility gate (todo:8d6c6886): the strip must not exist
 * for new/empty chats, and must offer SHARE (not the link panel) as its
 * initial state for a persisted session with turns. Interaction paths
 * (POST/copy/revoke) are fetch-driven and covered by the API tests
 * (share-api.test.ts); this file pins the render contract plus the
 * chat-view mount.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import ShareButton from '@/components/share-button';

const render = (props: { sessionId: string | null; hasTurns: boolean }) =>
  renderToStaticMarkup(createElement(ShareButton, props));

describe('ShareButton', () => {
  it('renders nothing without a persisted session', () => {
    expect(render({ sessionId: null, hasTurns: true })).toBe('');
  });

  it('renders nothing before the first assistant turn', () => {
    expect(render({ sessionId: 's1', hasTurns: false })).toBe('');
  });

  it('offers Share as the initial state for an eligible session', () => {
    const html = render({ sessionId: 's1', hasTurns: true });
    expect(html).toContain('data-testid="share-strip"');
    expect(html).toContain('Share');
    expect(html).not.toContain('Revoke'); // link panel only opens after a successful POST
  });
});

describe('chat-view mount', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../components/chat-view.tsx'),
    'utf8',
  );

  it('gates the strip on an assistant turn existing', () => {
    expect(src).toMatch(/<ShareButton sessionId=\{sessionId\} hasTurns=\{messages\.some\(m => m\.role === 'assistant'\)\}/);
  });

  it('shows the fork voice-downgrade notice once and strips the param (say-but-downgrade)', () => {
    expect(src).toMatch(/params\.get\('voiceDowngraded'\)/);
    expect(src).toMatch(/params\.delete\('voiceDowngraded'\)/);
    expect(src).toMatch(/voice-downgrade-notice/);
  });
});
