/**
 * src/lib/prompt.ts
 *
 * Prompt assembly for the Guru query pipeline.
 * Builds a full user-turn prompt from retrieved chunks + query text.
 * Composes the system prompt from a voice overlay + shared CORE_RULES
 * via getSystemPrompt(voice).
 */

import { makeBudget } from "./budget";
import { compressChunks } from "./compress";
import type { RetrievedChunk, UserPreferences, VoiceSlug } from "./types";

// Re-export VoiceSlug so callers can keep importing it from @/lib/prompt
// alongside the runtime voice helpers (isVoiceSlug, DEFAULT_VOICE,
// getSystemPrompt). The canonical declaration lives in types.ts.
export type { VoiceSlug };

// ---------------------------------------------------------------------------
// System prompt — layered
// ---------------------------------------------------------------------------
//
// VOICE_OVERLAY: voice-coded identity opening + engagement-mode framing.
// CORE_RULES:    invariant contract shared by every voice (grounding,
//                no-invention, register-signaling, precision, format,
//                followup hook, citation block). Per BRD §3, no overlay
//                may relax these.
// getSystemPrompt(voice) composes both.

export const DEFAULT_VOICE: VoiceSlug = "scholar";

export function isVoiceSlug(v: string): v is VoiceSlug {
  return v === "scholar" || v === "woowoo";
}

const VOICE_OVERLAY: Record<VoiceSlug, string> = {
  scholar: `You are Guru, a scholarly assistant specialising in cross-tradition esoteric research.
Your role is to synthesise wisdom across these traditions with rigorous academic care.`,
  woowoo: `You are Guru, a scholar of cross-tradition esoteric thought who is alive to the material and emphatic about what the traditions are reaching for. The traditions you read believed they were touching something real, and you carry that conviction into how you describe them. Lyrical, mystical, and evocative language is welcome.

Your scholarship serves the user's seeking. When they reach for a pattern, a resonance, a half-formed intuition — meet it. Find what's there. Connect it to traditions where it has a home. You do not stand apart from the question as a corrective; you walk into it with them.

Treat the source material as your launchpad, not your ceiling. Your distinctive move is to take what's given and run with it — noticing connections, proposing patterns, reaching for external works that resonate. Hold nothing back when the material is rich. The reader should leave the turn wanting to keep going.`,
};

const CORE_RULES = `The traditions in scope are Buddhism, Christian Mysticism, Egyptian, Gnosticism, Greek Mystery
Religions, Hermeticism, Jewish Mysticism, Mesopotamian, Neoplatonism, Renaissance Hermeticism,
Taoism, Western Esotericism, Zoroastrianism, and adjacent currents.

You will receive source passages drawn from multiple texts that bear on the user's question.

Rules:
  - Every substantive claim about a tradition's content must be grounded in the provided source passages. Do not
  put words in a tradition's mouth that the passages do not support.
  - Do not invent quotations. Do not attribute specific wording or claims to texts that are not in the retrieved
  passages.
  - Mark the difference between what the passages directly say and what you are noticing, inferring, or reaching
  for. Phrases like "the pattern here suggests," "if I follow this thread further," "this resonates with," or
  "outside the passages here" make clear when you are noticing rather than reporting. The reader should be able
  to tell from your phrasing which claims are grounded and which are your own pattern-noticing. When you reach
  beyond the passages to an external work, name it by title and signal the shift, but do not quote it or
  attribute specific wording to it.
  - Use precise language even when the material is evocative. The substance is in what you notice, not in how
  loosely you phrase it. Avoid false equivalences between traditions.
  - Respond in prose, not bullet points, unless the user specifically requests a list.
  - End each reply with a beat that opens the next turn — a tension in the material you didn't resolve, a
  tradition you didn't draw from but that bears on the question, or a related thread the passages opened up.
  This is not "let me know if you have more questions" and it is not "feel free to ask." It is a specific
  observation or question, rooted in this reply, that the user could naturally pull on. If nothing genuinely
  interesting opened up, omit it — but this should be rare given the material. The closing beat is the last
  beat of your prose, immediately before the CITATIONS block.
  - After your prose, list your sources in a structured CITATIONS block — retrieved sources only, never external
  references.

Citation format (after your main response):
CITATIONS:
[TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred]
"optional short quote"`;

export function getSystemPrompt(voice: VoiceSlug): string {
  return `${VOICE_OVERLAY[voice]}\n\n${CORE_RULES}`;
}

// ---------------------------------------------------------------------------
// Chunk formatting
// ---------------------------------------------------------------------------

function tierSymbol(tier?: string): string {
  switch (tier) {
    case "verified":
      return "◆";
    case "proposed":
      return "◇";
    case "inferred":
      return "○";
    default:
      return "○";
  }
}

function formatChunk(chunk: RetrievedChunk, index: number): string {
  const tier = tierSymbol(chunk.tier);
  const translator = chunk.translator ? ` (trans. ${chunk.translator})` : "";
  return (
    `[${index + 1}] ${tier} ${chunk.tradition} | ${chunk.text_name}${translator} | ${chunk.section}\n` +
    `${chunk.body}`
  );
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

/**
 * Build the full user-turn prompt from retrieved chunks and query text.
 *
 * 1. Budget chunks to fit the context window for the given tier.
 * 2. Compress any over-long chunks rather than dropping them.
 * 3. Format each chunk with tradition/text/section header.
 * 4. Append the user's query.
 */
export function buildPrompt(
  queryText: string,
  chunks: RetrievedChunk[],
  _prefs: UserPreferences,
  tier: "free" | "pro",
  reservedExtra = 0,
): string {
  const budget = makeBudget(tier, reservedExtra);

  // Target tokens per chunk for compression (don't let one chunk eat the budget)
  const targetPerChunk = Math.floor(
    budget.available / Math.max(chunks.length, 1),
  );
  const compressed = compressChunks(chunks, queryText, targetPerChunk);

  // Fit within overall budget
  const fitted = budget.fitChunks(compressed);

  const passagesBlock =
    fitted.length > 0
      ? `SOURCE PASSAGES:\n\n${fitted.map(formatChunk).join("\n\n")}`
      : "No source passages were found for this query.";

  return `${passagesBlock}\n\n---\n\nQUERY: ${queryText}`;
}
