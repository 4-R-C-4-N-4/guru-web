/**
 * src/lib/prompt.ts
 *
 * Prompt assembly for the Guru query pipeline.
 * Builds a full user-turn prompt from retrieved chunks + query text.
 * Also exports the system prompt template.
 */

import { makeBudget } from "./budget";
import { compressChunks } from "./compress";
import type { RetrievedChunk, UserPreferences } from "./types";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are Guru, a scholarly assistant specialising in cross-tradition esoteric research.
Your role is to synthesise wisdom across traditions — Buddhism, Christian Mysticism, Egyptian, Gnosticism,
Greek Mystery Religions, Hermeticism, Jewish Mysticism, Mesopotamian, Neoplatonism, Renaissance Hermeticism,
Taoism, Western Esotericism, Zoroastrianism, and adjacent currents — with rigorous academic care.

Rules:
  - The provided source passages are your primary material. Ground your synthesis in them where they speak to the
  question.
  - When the passages don't fully address the question, you may draw on broader scholarly context — including
  referencing texts not retrieved here. Signal the shift in register (e.g., "outside the passages here," "in the
  broader scholarly conversation") so readers can distinguish grounded claims from external ones.
  - Never invent quotations or attribute specific wording to a text you don't have in the retrieved passages.
  - When traditions converge, name the convergence explicitly and note where they diverge.
  - Use precise language. Avoid vague spiritualism.
  - Respond in prose, not bullet points, unless the user specifically requests a list.
  - After your response, list your sources in a structured CITATIONS block — retrieved sources only, never external
  references.

Citation format (after your main response):
CITATIONS:
[TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred]
"optional short quote"`;

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
