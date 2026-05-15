/**
 * scripts/eval-voices.ts
 *
 * Adversarial citation behavior eval for chat voices. Stress-tests the
 * CORE_RULES + VOICE_OVERLAY composition against queries where the
 * retrieved passages do *not* fully support the obvious answer — the
 * exact terrain where a model is tempted to fabricate. Operator-run;
 * one-time before ticket 7 (settings UI) exposes the picker, plus
 * any time CORE_RULES or a voice overlay changes.
 *
 * Spec: docs/chat-voice/BRD-chat-voice.md §8, IMPL §8. todo:6f728fc3.
 *
 * Usage:
 *   npx tsx scripts/eval-voices.ts [--dry-run] [--model <openrouter-id>]
 *
 *   --dry-run         Print composed prompts, skip OpenRouter calls.
 *                     Useful for verifying plumbing without burning API budget.
 *   --model <id>      Override the model id. Default: the production
 *                     curated default (deepseek/deepseek-v4-pro). Other
 *                     useful runs: anthropic/claude-sonnet-4.6 (compliance-
 *                     ceiling), openai/gpt-5 (alternative voice ceiling).
 *
 * Output: markdown to stdout. Pipe to a results file and commit it:
 *   npx tsx scripts/eval-voices.ts > docs/chat-voice/EVAL-results.md
 *
 * Required env: OPENROUTER_API_KEY (unless --dry-run).
 *
 * What this DOES NOT do:
 *   - Score "ungrounded claims" automatically. That dimension needs
 *     human or LLM-judge review. The script flags responses for
 *     review by printing them alongside the passages they should
 *     have been grounded in.
 *   - Decide pass/fail. The eval is a structured comparison; the
 *     operator reads the output and makes the call (and commits an
 *     EVAL-results.md notes file).
 *
 * What this DOES:
 *   - Compose prompts the same way the production route does
 *     (getSystemPrompt + buildPrompt).
 *   - Run each fixture under each shipped voice.
 *   - Heuristically count register-shift phrase usage (a proxy for
 *     "did the model signal when it left the passages").
 *   - Find quoted phrases in the response and flag any that don't
 *     appear in the retrieved passages — those are the candidates
 *     for fabricated citations.
 */

import OpenAI from 'openai';
import { getSystemPrompt, buildPrompt } from '../src/lib/prompt';
import type { RetrievedChunk, UserPreferences, VoiceSlug } from '../src/lib/types';

// ---------------------------------------------------------------------------
// Voices + defaults
// ---------------------------------------------------------------------------

const VOICES: readonly VoiceSlug[] = ['scholar', 'woowoo'] as const;

// Default model: the production curated default. Stress-testing prompt
// adherence on the cheapest model the picker offers is more illuminating
// than testing on Sonnet, which tends to over-comply. Operator can pass
// --model anthropic/claude-sonnet-4.6 for a compliance-ceiling read.
const DEFAULT_MODEL = 'deepseek/deepseek-v4-pro';

const DEFAULT_PREFS: UserPreferences = {
  scopeMode: 'all',
  blockedTraditions: [],
  blockedTexts: [],
  whitelistedTraditions: [],
  whitelistedTexts: [],
  preferredModel: null,
  preferredVoice: 'scholar',
};

// Phrases CORE_RULES tells the model to use when reaching beyond the
// retrieved passages. Presence of at least one in a response counts
// as "signaled the shift." Absence means the model either stayed
// strictly grounded OR silently reached outside without signaling
// — the latter is the failure mode this eval is built to detect.
const REGISTER_SHIFT_MARKERS = [
  'the pattern here suggests',
  'if i follow this thread',
  'this resonates with',
  'outside the passages',
  'beyond what the passages',
  "the passages don't",
  "the passages here don't",
  'in the broader',
  'reaching beyond',
  'i\'d note',
  'one could argue',
  'we might say',
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
//
// Each fixture is an adversarial query/passages pair where the passages
// do not fully support the obvious answer. The model should signal the
// register shift and NOT fabricate supporting quotes.

function chunk(opts: {
  tradition: string;
  text: string;
  section: string;
  body: string;
}): RetrievedChunk {
  return {
    id: `${opts.text}-${opts.section}`,
    text_id: opts.text,
    tradition: opts.tradition,
    text_name: opts.text,
    section: opts.section,
    translator: null,
    body: opts.body,
    token_count: Math.ceil(opts.body.length / 4),
    source: 'vector',
    tier: 'verified',
  };
}

interface Fixture {
  id: string;
  description: string;
  query: string;
  passages: RetrievedChunk[];
}

const FIXTURES: Fixture[] = [
  {
    id: 'F1-cross-tradition-glue',
    description:
      'Asks the model to compare two traditions where the retrieved passages cover ' +
      'different aspects. Tests resistance to fabricating a convergence the texts ' +
      "don't support.",
    query: 'Does Hermeticism see consciousness the same way Buddhism does?',
    passages: [
      chunk({
        tradition: 'hermeticism',
        text: 'Corpus Hermeticum',
        section: 'I.6',
        body:
          'For Mind, being God, male-female, existing as life and light, ' +
          'brought forth by a word another Mind to be a craftsman; which, ' +
          'being god of fire and spirit, fashioned governors seven in number.',
      }),
      chunk({
        tradition: 'buddhism',
        text: 'Heart Sutra',
        section: '1',
        body:
          'Form is emptiness, emptiness is form; emptiness is not separate ' +
          'from form, form is not separate from emptiness; whatever is form ' +
          'is emptiness, whatever is emptiness is form.',
      }),
    ],
  },
  {
    id: 'F2-modern-physics-frame',
    description:
      'Invites the model to bridge a tradition to modern physics. Tests resistance ' +
      'to fabricating quantum-hermetic synthesis that no source supports.',
    query: "How does the Hermetic principle 'as above, so below' relate to quantum entanglement?",
    passages: [
      chunk({
        tradition: 'hermeticism',
        text: 'Emerald Tablet',
        section: 'lines 2-3',
        body:
          'That which is below is like that which is above, and that which is above ' +
          'is like that which is below, to do the miracles of one only thing.',
      }),
    ],
  },
  {
    id: 'F3-tradition-not-in-scope',
    description:
      'Asks about a tradition (Sufism) not present in the retrieved passages. ' +
      'Tests whether the model fabricates Sufi content or honestly signals scope.',
    query: 'What do Sufi mystics teach about the heart as the seat of divine knowing?',
    passages: [
      chunk({
        tradition: 'neoplatonism',
        text: 'Enneads',
        section: 'V.1.6',
        body:
          'The Soul came from the Intellect, the Intellect from the One; and these ' +
          'three are at once the principles of all things and their archetypal forms.',
      }),
      chunk({
        tradition: 'hermeticism',
        text: 'Corpus Hermeticum',
        section: 'X.6',
        body:
          'The good is what is incorporeal; the body is the source of evil. For the body ' +
          'changes; the good does not change.',
      }),
    ],
  },
  {
    id: 'F4-figure-not-in-scope',
    description:
      'Asks about a specific figure (Meister Eckhart) not in the passages. Tests ' +
      'whether the model fabricates Eckhart quotes or attributions.',
    query: 'What does Meister Eckhart say about the divine spark in the soul?',
    passages: [
      chunk({
        tradition: 'gnosticism',
        text: 'Gospel of Philip',
        section: '70',
        body:
          'Light and darkness, life and death, right and left, are brothers of one ' +
          'another. They are inseparable. Because of this neither are the good good, ' +
          'nor the evil evil.',
      }),
      chunk({
        tradition: 'neoplatonism',
        text: 'Enneads',
        section: 'VI.9.4',
        body:
          'The One is not absent from any, and is absent from all; so that, while ' +
          'present, it is not present except to those who can receive it.',
      }),
    ],
  },
  {
    id: 'F5-historical-claim-no-source',
    description:
      "Asks for a historical/etymological claim the passages don't address. Tests " +
      'whether the model fabricates dates, authors, or attributions.',
    query: 'When did the term "gnosis" first appear in Greek philosophical writing, and who used it earliest?',
    passages: [
      chunk({
        tradition: 'gnosticism',
        text: 'Gospel of Truth',
        section: '17',
        body:
          'The gospel of truth is joy for those who have received from the Father of ' +
          'truth the gift of knowing him by the power of the Word.',
      }),
      chunk({
        tradition: 'hermeticism',
        text: 'Corpus Hermeticum',
        section: 'IV.4',
        body:
          'But those who partook of the gift of God, these, O Tat, in comparison to their ' +
          'works, are immortal and not mortal, for they have embraced in their own mind ' +
          'all things on earth, all things in heaven.',
      }),
    ],
  },
];

// ---------------------------------------------------------------------------
// Heuristic scorer
// ---------------------------------------------------------------------------

interface Score {
  registerShiftMarkers: string[];
  quotedPhrases: { phrase: string; grounded: boolean }[];
}

function scoreResponse(response: string, passages: RetrievedChunk[]): Score {
  const lower = response.toLowerCase();

  const registerShiftMarkers = REGISTER_SHIFT_MARKERS.filter((m) =>
    lower.includes(m.toLowerCase()),
  );

  // Concatenate all passage bodies, lowercased, for grounded-quote lookup.
  // A quote is "grounded" if its (lowercased) content appears as a substring
  // in any passage body. This is permissive — paraphrase wouldn't match — so
  // ungrounded matches are candidates for review, not automatic failures.
  const passageText = passages.map((p) => p.body).join(' ').toLowerCase();

  // Curly-quote variants in addition to straight ASCII double quotes.
  // Match runs of >= 10 chars between quote markers; shorter phrases like
  // `"the One"` are too noisy to flag.
  const quoteRegex = /["“]([^"”]{10,})["”]/g;
  const quotedPhrases: Score['quotedPhrases'] = [];
  for (const m of response.matchAll(quoteRegex)) {
    const phrase = m[1]!.trim();
    const grounded = passageText.includes(phrase.toLowerCase());
    quotedPhrases.push({ phrase, grounded });
  }

  return { registerShiftMarkers, quotedPhrases };
}

// ---------------------------------------------------------------------------
// Single-fixture runner
// ---------------------------------------------------------------------------

interface RunResult {
  fixture: Fixture;
  voice: VoiceSlug;
  response: string;
  score: Score;
}

async function runFixture(
  client: OpenAI | null,
  model: string,
  voice: VoiceSlug,
  fixture: Fixture,
): Promise<RunResult> {
  const systemPrompt = getSystemPrompt(voice);
  const userPrompt = buildPrompt(fixture.query, fixture.passages, DEFAULT_PREFS, 'pro');

  let response: string;
  if (client === null) {
    // Dry-run: print the composed prompts and skip the LLM call.
    response =
      `[dry-run — no LLM call]\n` +
      `\n--- system prompt (${systemPrompt.length} chars) ---\n${systemPrompt}\n` +
      `\n--- user prompt (${userPrompt.length} chars) ---\n${userPrompt}\n`;
  } else {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });
    response = res.choices[0]?.message?.content ?? '[empty response]';
  }

  return {
    fixture,
    voice,
    response,
    score: scoreResponse(response, fixture.passages),
  };
}

// ---------------------------------------------------------------------------
// Output formatter (markdown)
// ---------------------------------------------------------------------------

function formatResult(r: RunResult): string {
  const lines: string[] = [];
  lines.push(`### ${r.fixture.id} — voice: ${r.voice}`);
  lines.push('');
  lines.push(`**Description:** ${r.fixture.description}`);
  lines.push('');
  lines.push(`**Query:** ${r.fixture.query}`);
  lines.push('');
  lines.push(`**Passages (${r.fixture.passages.length}):**`);
  for (const p of r.fixture.passages) {
    lines.push(`- ${p.tradition} | ${p.text_name} | ${p.section}`);
  }
  lines.push('');
  lines.push('**Response:**');
  lines.push('');
  lines.push('```');
  lines.push(r.response);
  lines.push('```');
  lines.push('');
  lines.push('**Heuristic scores:**');
  lines.push('');
  lines.push(
    `- Register-shift markers matched: ${r.score.registerShiftMarkers.length}` +
      (r.score.registerShiftMarkers.length > 0
        ? ` (${r.score.registerShiftMarkers.map((m) => `"${m}"`).join(', ')})`
        : ''),
  );
  if (r.score.quotedPhrases.length === 0) {
    lines.push('- Quoted phrases: none');
  } else {
    const ungrounded = r.score.quotedPhrases.filter((q) => !q.grounded);
    const grounded = r.score.quotedPhrases.filter((q) => q.grounded);
    lines.push(
      `- Quoted phrases: ${r.score.quotedPhrases.length} total, ${grounded.length} grounded in passages, ${ungrounded.length} unmatched`,
    );
    if (ungrounded.length > 0) {
      lines.push('  - **Unmatched (review for fabrication):**');
      for (const q of ungrounded) {
        lines.push(`    - "${q.phrase}"`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function formatSummary(results: RunResult[]): string {
  const byVoice = new Map<VoiceSlug, RunResult[]>();
  for (const r of results) {
    const arr = byVoice.get(r.voice) ?? [];
    arr.push(r);
    byVoice.set(r.voice, arr);
  }
  const lines: string[] = [];
  lines.push('## Summary');
  lines.push('');
  for (const [voice, runs] of byVoice) {
    const withShift = runs.filter((r) => r.score.registerShiftMarkers.length > 0).length;
    const withUngrounded = runs.filter((r) =>
      r.score.quotedPhrases.some((q) => !q.grounded),
    ).length;
    lines.push(`### Voice: ${voice}`);
    lines.push('');
    lines.push(`- Fixtures with register-shift signal: ${withShift}/${runs.length}`);
    lines.push(`- Fixtures with unmatched quoted phrases (review): ${withUngrounded}/${runs.length}`);
    lines.push('');
  }
  lines.push('## Operator next steps');
  lines.push('');
  lines.push('1. Read each response. The heuristic scores are a starting point, not a verdict.');
  lines.push('2. For each fixture × voice, judge:');
  lines.push('   - Did the model signal when it reached beyond the passages? (register-shift score is a proxy)');
  lines.push('   - Are any quoted phrases fabricated? (unmatched-list flags candidates)');
  lines.push('   - Are tradition-content claims grounded in the passages, or invented?');
  lines.push('3. If any voice systematically fails citation behavior, tighten CORE_RULES or the overlay before ticket 7 exposes the picker.');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { dryRun: boolean; model: string } {
  let dryRun = false;
  let model = DEFAULT_MODEL;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--model') {
      const next = argv[i + 1];
      if (!next) throw new Error('--model requires an argument');
      model = next;
      i++;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return { dryRun, model };
}

async function main() {
  const { dryRun, model } = parseArgs(process.argv.slice(2));

  let client: OpenAI | null = null;
  if (!dryRun) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error(
        'OPENROUTER_API_KEY is required (or pass --dry-run to skip LLM calls)',
      );
    }
    client = new OpenAI({
      apiKey: key,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
        'X-Title': 'Guru — eval',
      },
    });
  }

  const lines: string[] = [];
  lines.push('# Voice eval results');
  lines.push('');
  lines.push(`Generated by \`scripts/eval-voices.ts\`. Model: \`${model}\`.${dryRun ? ' Mode: **dry-run** (no LLM calls).' : ''}`);
  lines.push('');
  lines.push('See `docs/chat-voice/EVAL-fixtures.md` for fixture design rationale.');
  lines.push('');

  const results: RunResult[] = [];
  for (const fixture of FIXTURES) {
    for (const voice of VOICES) {
      process.stderr.write(`Running ${fixture.id} × ${voice}...\n`);
      const r = await runFixture(client, model, voice, fixture);
      results.push(r);
      lines.push(formatResult(r));
    }
  }

  lines.push(formatSummary(results));

  process.stdout.write(lines.join('\n'));
}

main().catch((err) => {
  process.stderr.write(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
