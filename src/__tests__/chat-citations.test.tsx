/**
 * src/__tests__/chat-citations.test.tsx
 *
 * Regression for todo:50b9a90a — the assistant's raw CITATIONS tail (always
 * emitted per prompt.ts CORE_RULES) must NOT render as plaintext in the chat
 * prose; sources show only as styled <Citation> cards under "References".
 *
 * Rendered statically (react-dom/server); useIsMobile returns its server
 * snapshot and effects don't run, so the initial render reflects the props.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatView, { type Message } from '@/components/chat-view';

const BODY = 'The One is beyond being, and naming fails it.';
const RAW = `${BODY}\n\nCITATIONS:\n[neoplatonism | Enneads | V.1 | TIER: verified]\n"The One is all things and no one of them."`;

describe('chat-view CITATIONS handling', () => {
  it('strips the raw CITATIONS block from the prose but keeps the body', () => {
    const msg: Message = {
      role: 'assistant',
      text: RAW,
      citations: [{ tradition: 'neoplatonism', text: 'Enneads', section: 'V.1' }],
    };
    const html = renderToStaticMarkup(<ChatView initialMessages={[msg]} />);

    expect(html).toContain('beyond being');         // prose survives
    expect(html).not.toContain('CITATIONS:');        // raw marker gone
    expect(html).not.toContain('| TIER: verified');  // raw entry line gone
    expect(html).toContain('References');             // styled block present
    expect(html).toContain('Enneads');                // card content present
  });

  it('falls back to the parsed block for cards when no chunks_used citations are attached', () => {
    const msg: Message = { role: 'assistant', text: RAW }; // no citations array
    const html = renderToStaticMarkup(<ChatView initialMessages={[msg]} />);

    expect(html).not.toContain('CITATIONS:');
    expect(html).toContain('References');
    expect(html).toContain('Enneads'); // rebuilt from the parsed tail
  });
});
