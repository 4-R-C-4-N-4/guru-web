/**
 * src/__tests__/chat-view.test.ts
 *
 * Tests for the shared chat view (todo:45a8b6bc).
 *   - recordsToMessages: pure transform from persisted QueryRecord rows
 *     into the in-memory Message[] the UI renders.
 *   - URL-update contract: first-message URL change must use
 *     window.history.replaceState, NOT next/navigation router.replace.
 *     If a real route change fires, the App Router unmounts /chat and
 *     mounts /chat/[sessionId] — losing the in-flight stream and
 *     dropping the response into the resume stub.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { recordsToMessages } from '@/components/chat-view';

describe('recordsToMessages', () => {
  it('returns [] for empty input', () => {
    expect(recordsToMessages([])).toEqual([]);
  });

  it('expands one QueryRecord into a user + assistant pair', () => {
    const out = recordsToMessages([
      { query_text: 'What is gnosis?', response_text: 'Direct knowing.' },
    ]);
    expect(out).toEqual([
      { role: 'user',      content: 'What is gnosis?' },
      { role: 'assistant', text:    'Direct knowing.' },
    ]);
  });

  it('preserves order across multiple records', () => {
    const out = recordsToMessages([
      { query_text: 'Q1', response_text: 'A1' },
      { query_text: 'Q2', response_text: 'A2' },
    ]);
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(out[0]!.content).toBe('Q1');
    expect(out[1]!.text).toBe('A1');
    expect(out[2]!.content).toBe('Q2');
    expect(out[3]!.text).toBe('A2');
  });

  it('omits citations when the API returned none (back-compat for old sessions)', () => {
    const out = recordsToMessages([
      { query_text: 'Q', response_text: 'A' },
    ]);
    expect(out[1]!.citations).toBeUndefined();
  });

  it('passes citations through to the assistant message (todo:89af833a)', () => {
    const citations = [
      { tradition: 'gnosticism', text: 'Gospel of Philip', section: '78', tier: 'verified' as const },
    ];
    const out = recordsToMessages([
      { query_text: 'Q', response_text: 'A', citations },
    ]);
    expect(out[1]!.role).toBe('assistant');
    expect(out[1]!.citations).toEqual(citations);
    // User messages never get citations (the user typed the question).
    expect(out[0]!.citations).toBeUndefined();
  });

  // ── Per-response attribution surface (BRD §7.4 / C6) ───────────────
  it('passes through model_used + tokens + cost_usd from persisted records', () => {
    const out = recordsToMessages([{
      query_text:    'Q',
      response_text: 'A',
      model_used:    'anthropic/claude-sonnet-4.6',
      input_tokens:  1234,
      output_tokens: 567,
      cost_usd:      0.0451,
    }]);
    const assistant = out[1]!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.modelUsed).toBe('anthropic/claude-sonnet-4.6');
    expect(assistant.inputTokens).toBe(1234);
    expect(assistant.outputTokens).toBe(567);
    expect(assistant.costUsd).toBeCloseTo(0.0451, 6);
  });

  it('omits attribution fields entirely when the record lacks them (legacy rows)', () => {
    // Pre-cost-tracking rows. The chat-view render guards on
    // msg.modelUsed, so omitting the fields hides the line.
    const out = recordsToMessages([{ query_text: 'Q', response_text: 'A' }]);
    const assistant = out[1]!;
    expect(assistant.modelUsed).toBeUndefined();
    expect(assistant.inputTokens).toBeUndefined();
    expect(assistant.outputTokens).toBeUndefined();
    expect(assistant.costUsd).toBeUndefined();
  });

  it('omits attribution fields when the record carries explicit nulls (truncated stream)', () => {
    // Stream truncated before the usage chunk arrived → cost_usd
    // persisted as NULL. The chat view shouldn't render a partial
    // line ("anthropic/... · NaN tokens · $0.NaN").
    const out = recordsToMessages([{
      query_text: 'Q', response_text: 'A',
      model_used: 'anthropic/claude-sonnet-4.6',
      input_tokens: null, output_tokens: null, cost_usd: null,
    }]);
    const assistant = out[1]!;
    expect(assistant.modelUsed).toBe('anthropic/claude-sonnet-4.6');
    expect(assistant.inputTokens).toBeUndefined();
    expect(assistant.outputTokens).toBeUndefined();
    expect(assistant.costUsd).toBeUndefined();
  });
});

describe('chat-view markdown rendering', () => {
  // Source-level guards. Locks in that assistant messages render through
  // react-markdown with remark-gfm and that user messages stay plain
  // text (the user typed those literally; we don't want their **stars**
  // turning into <strong>). Catches a future refactor that drops the
  // markdown wrapper.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    resolve(__dirname, '../components/chat-view.tsx'),
    'utf8',
  );

  it('imports react-markdown + remark-gfm', () => {
    expect(SRC).toMatch(/import\s+ReactMarkdown.*from\s+['"]react-markdown['"]/);
    expect(SRC).toMatch(/import\s+remarkGfm\s+from\s+['"]remark-gfm['"]/);
  });

  it('wraps the assistant text in <ReactMarkdown> with remarkGfm', () => {
    // The assistant render path uses ReactMarkdown; remarkGfm is passed
    // in remarkPlugins so tables/strikethrough/task lists/autolinks work.
    expect(SRC).toMatch(/<ReactMarkdown[^>]*remarkPlugins=\{\[remarkGfm\]\}/);
    // The child is the CITATIONS-stripped body (bodyText), not the raw msg.text
    // — the raw tail is rendered as styled cards instead (todo:50b9a90a).
    expect(SRC).toMatch(/\{bodyText\}\s*<\/ReactMarkdown>/);
  });

  it('user messages render as plain text (not through markdown)', () => {
    // The user branch should still render {msg.content} directly.
    expect(SRC).toMatch(/\{msg\.content\}/);
  });
});

describe('chat-view model-picker announcement banner (todo:f238dc42)', () => {
  // Same source-level approach as the markdown describe above.
  // Locks in:
  //   - localStorage key is versioned (so a future banner doesn't
  //     un-dismiss this one),
  //   - banner only shows when tier === 'pro',
  //   - dismiss writes the key,
  //   - reads tier from /api/quota.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    resolve(__dirname, '../components/chat-view.tsx'),
    'utf8',
  );

  it('declares a versioned localStorage key', () => {
    expect(SRC).toMatch(/MODEL_PICKER_BANNER_KEY\s*=\s*['"]guru\.banner\.modelpicker\.v1['"]/);
  });

  it('gates banner show on tier === "pro"', () => {
    // useMemo derives showPickerBanner; first short-circuits when
    // tier isn't 'pro'.
    expect(SRC).toMatch(/if \(tier !== ['"]pro['"]\) return false/);
  });

  it('dismiss writes the key to localStorage', () => {
    expect(SRC).toMatch(/localStorage\.setItem\(MODEL_PICKER_BANNER_KEY, ['"]1['"]\)/);
  });

  it('reads localStorage and treats "1" as dismissed', () => {
    expect(SRC).toMatch(/localStorage\.getItem\(MODEL_PICKER_BANNER_KEY\) !== ['"]1['"]/);
  });

  it('reads tier from /api/quota response', () => {
    // The quota effect should now consume tier in addition to used/limit.
    expect(SRC).toMatch(/tier\??:\s*['"]free['"]\s*\|\s*['"]pro['"]/);
    expect(SRC).toMatch(/setTier/);
  });

  it('renders banner block with data-testid + dismiss button', () => {
    expect(SRC).toMatch(/data-testid=['"]model-picker-banner['"]/);
    expect(SRC).toMatch(/aria-label=['"]Dismiss banner['"]/);
    // Banner copy frames the picker positively (todo:e8105324
    // reframe — no "cost" language, names the providers).
    expect(SRC).toMatch(/choose how Guru answers/);
    expect(SRC).toMatch(/Adjust in/);
    expect(SRC).toMatch(/href=['"]\/settings['"]/);
    // Negative guard: never reintroduce cost framing in the banner.
    expect(SRC).not.toMatch(/cost reasons/);
  });
});

describe('chat-view streaming attribution (post-fix #1)', () => {
  // Source-level guard. The streaming path reads X-Model-Used from
  // the response headers and seeds it on the assistant message so the
  // attribution badge renders during the live stream — not just after
  // a session reload via recordsToMessages.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    resolve(__dirname, '../components/chat-view.tsx'),
    'utf8',
  );

  it('reads X-Model-Used from the response headers', () => {
    expect(SRC).toMatch(/res\.headers\.get\(['"]X-Model-Used['"]\)/);
  });

  it('seeds modelUsed on the assistant message before the stream loop', () => {
    // The setMessages call that adds the empty placeholder spreads
    // modelUsed conditionally (only when the header was present).
    expect(SRC).toMatch(/modelUsedHeader && \{ modelUsed: modelUsedHeader \}/);
  });
});

describe('chat-view UX simplification (todo:e8105324)', () => {
  // Source-level guards locking in the C9 reframe:
  //   - per-response attribution shows 'via <Provider>' only,
  //     not model id / tokens / cost.
  //   - quota header shows 'X today' (no hard ceiling).
  //   - 429 copy doesn't mention 'spend'.
  //   - displayForModelId is the source of the badge metadata.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    resolve(__dirname, '../components/chat-view.tsx'),
    'utf8',
  );

  it('imports displayForModelId from provider-display', () => {
    expect(SRC).toMatch(/import\s+\{\s*displayForModelId\s*\}\s+from\s+['"]@\/lib\/provider-display['"]/);
  });

  it('attribution renders "via <name>" — no tokens, no cost, no model id', () => {
    expect(SRC).toMatch(/via\s+<span style=\{\{\s*color:\s*display\.color/);
    // Token + cost rendering must not be in the file anymore.
    expect(SRC).not.toMatch(/fmtTokens/);
    expect(SRC).not.toMatch(/msg\.costUsd\?\.toFixed/);
    expect(SRC).not.toMatch(/\{msg\.modelUsed\}/);  // raw id render — gone
  });

  it('quota header shows "X today", not "X/Y remaining today"', () => {
    expect(SRC).toMatch(/\{quotaUsed\} today/);
    expect(SRC).not.toMatch(/remaining today/);
    expect(SRC).not.toMatch(/quotaRemaining/);  // unused var dropped
  });

  it('429 copy uses "Daily question limit" — never "spend" or "query limit"', () => {
    expect(SRC).toMatch(/Daily question limit/);
    expect(SRC).not.toMatch(/Daily spend limit/);
    expect(SRC).not.toMatch(/Daily query limit/);
  });
});

describe('chat-view autoscroll stick-to-bottom (todo:7b4450d8)', () => {
  // Source-level guards. The bug: smooth-scrollIntoView fired on every
  // streamed token, jittering the viewport and trapping the user at the
  // bottom — they couldn't scroll up to re-read while the LLM streamed.
  // Fix: stick-to-bottom pattern with instant scroll.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    resolve(__dirname, '../components/chat-view.tsx'),
    'utf8',
  );

  it('does not smooth-scroll on every message update', () => {
    // The old behaviour: scrollIntoView({ behavior: 'smooth' }) on every
    // [messages, loading] change. Smooth scroll per streamed token is
    // the jitter source — even when autoscroll is wanted.
    expect(SRC).not.toMatch(/scrollIntoView\(\s*\{\s*behavior:\s*['"]smooth['"]/);
  });

  it('tracks stick-to-bottom via a ref (not state — scroll fires per pixel)', () => {
    expect(SRC).toMatch(/stickToBottomRef\s*=\s*useRef\(true\)/);
  });

  it('handleScroll flips sticky off when the user scrolls away from bottom', () => {
    // Distance-from-bottom threshold. The actual number is a tuning
    // knob; the contract is that sticky is derived from scroll position.
    expect(SRC).toMatch(/scrollHeight\s*-\s*el\.scrollTop\s*-\s*el\.clientHeight/);
    expect(SRC).toMatch(/stickToBottomRef\.current\s*=\s*distanceFromBottom\s*<\s*\d+/);
  });

  it('autoscroll effect short-circuits when not sticky', () => {
    // The useEffect that fires on [messages, loading] must early-return
    // when the user has scrolled up. Otherwise we'd yank them back to
    // the bottom on every streamed token.
    expect(SRC).toMatch(/if\s*\(!stickToBottomRef\.current\)\s*return/);
  });

  it('uses instant scrollTop assignment, not scrollIntoView', () => {
    // Direct scrollTop = scrollHeight is instant and reliable; avoids
    // browser-level smooth interpolation that compounds per-token.
    expect(SRC).toMatch(/el\.scrollTop\s*=\s*el\.scrollHeight/);
  });

  it('wires onScroll + ref to the messages container', () => {
    expect(SRC).toMatch(/ref=\{scrollContainerRef\}\s+onScroll=\{handleScroll\}/);
  });

  it('handleSend re-engages sticky (user sending a question wants the response)', () => {
    // Otherwise: user scrolls up to re-read, types a question, hits
    // send — their question scrolls off-screen below the viewport.
    expect(SRC).toMatch(/stickToBottomRef\.current\s*=\s*true/);
  });
});

describe('chat-view URL-update contract', () => {
  // Source-level guards. The chat UI is React + DOM-heavy; we don't have
  // a DOM test harness configured. These string checks are blunt but
  // sufficient to lock in the regression: a router.replace into the
  // [sessionId] route swaps components and loses the in-flight stream.

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = readFileSync(
    resolve(__dirname, '../components/chat-view.tsx'),
    'utf8',
  );

  it('uses window.history.replaceState to update the URL on first message', () => {
    expect(SRC).toMatch(/window\.history\.replaceState\(/);
  });

  it('does not call router.replace or router.push for /chat/<id>', () => {
    expect(SRC).not.toMatch(/router\.replace\s*\(/);
    expect(SRC).not.toMatch(/router\.push\s*\(\s*[`'"]\/chat\//);
  });
});
