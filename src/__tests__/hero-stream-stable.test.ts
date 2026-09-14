/**
 * src/__tests__/hero-stream-stable.test.ts
 *
 * Regression guard for todo:ff85dc98 — the homepage hero re-centered on every
 * streamed token, shifting the answer text while it was being read.
 *
 * The hero (<section> in landing.tsx) centers its content vertically only
 * UNTIL a question is asked; once asking it must top-anchor so the streaming
 * answer grows downward instead of re-centering the whole column. The signal
 * is AskView's onActive callback (fired at submit), lifted into the hero's
 * `asking` state. Behaviour isn't testable without a DOM + streaming fetch
 * (this project has no jsdom — see ask-view.test.tsx), so we pin the wiring at
 * the source level, matching landing-cta.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const LANDING_SRC  = read('../components/landing.tsx');
const ASK_VIEW_SRC = read('../components/ask-view.tsx');

describe('hero stays anchored while the answer streams (todo:ff85dc98)', () => {
  it('AskView exposes an onActive(active) callback and fires it when a question is submitted', () => {
    // Prop is declared with a boolean payload…
    expect(ASK_VIEW_SRC).toMatch(/onActive\?\s*:\s*\(active:\s*boolean\)\s*=>\s*void/);
    // …invoked with true in handleAsk, before the answer streams…
    expect(ASK_VIEW_SRC).toContain('onActive?.(true)');
    // …and with false when a query errors before any answer, so the hero
    // re-centers instead of stranding the composer above an empty gap.
    expect(ASK_VIEW_SRC).toContain('onActive?.(false)');
  });

  it('landing lifts onActive into an `asking` state', () => {
    expect(LANDING_SRC).toMatch(/const\s*\[\s*asking\s*,\s*setAsking\s*\]\s*=\s*useState\(false\)/);
    expect(LANDING_SRC).toContain('onActive={setAsking}');
  });

  it('the hero centers only until asking, then top-anchors (no re-center on stream)', () => {
    // The load-bearing line: justifyContent must be conditional on `asking`,
    // centering before and flex-start after. A bare justifyContent:'center'
    // here is exactly the regression.
    expect(LANDING_SRC).toMatch(/justifyContent:\s*asking\s*\?\s*'flex-start'\s*:\s*'center'/);
  });
});
