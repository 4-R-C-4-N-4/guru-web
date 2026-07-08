/**
 * src/lib/prompt.ts
 *
 * Prompt assembly for the Guru query pipeline.
 * Builds a full user-turn prompt from retrieved chunks + query text.
 * Composes the system prompt from a voice overlay + shared CORE_RULES
 * via getSystemPrompt(voice).
 */

import { makeBudget, estimateTokens } from "./budget";
import { compressChunks } from "./compress";
import type { RetrievedChunk, UserPreferences, VoiceSlug, WorkDossier } from "./types";
import type { AtlasSnapshot, AtlasChunk } from "./atlas";

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
[TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred/summary]
"optional short quote"`;

export function getSystemPrompt(voice: VoiceSlug): string {
  return `${VOICE_OVERLAY[voice]}\n\n${CORE_RULES}`;
}

// ---------------------------------------------------------------------------
// Blog essayist (grounded blog pipeline)
// ---------------------------------------------------------------------------
//
// The blog generator (src/lib/blog-generate.ts) is a second caller of the
// RAG chain: it turns a cross-tradition concept pair into a long-form
// grounded essay rather than a chat turn. It uses its own overlay + rules
// so the *grounding* contract is shared verbatim with CORE_RULES, but the
// *shape* is an essay (title, dek, development, close, citations) instead
// of a single conversational turn that "opens the next turn".
//
// The voice is internal and never user-selectable — one blog voice this
// phase (BRD §1.5, §3). VoiceSlug is deliberately untouched.

// BLOG_OVERLAY: the essayist identity that precedes BLOG_RULES.
const BLOG_OVERLAY = `You are a comparative-religion essayist writing for a thoughtful general
reader. You take a single resonance between two traditions and trace it with
rigor and grace — at home in primary texts, precise about where traditions
genuinely converge and where the likeness breaks. Your register is literary
but exact: an essay, not a lecture, and never a sermon.`;

// BLOG_RULES carries the same invariant grounding contract as CORE_RULES
// (grounding / no-invented-quotes / notice-vs-report / family-resemblance
// are reproduced verbatim in substance), but replaces the chat closer —
// which assumes a single turn that "opens the next turn" — with essay shape
// and a parseable structured head/tail the generator can split on.
const BLOG_RULES = `Your sources are the SOURCE PASSAGES below — primary religious texts retrieved
from a curated corpus. Treat them as your only authority.

GROUNDING:
  - Every substantive claim about a tradition's content must be grounded in the
  provided source passages. Do not put words in a tradition's mouth that the
  passages do not support.
  - Do not invent quotations. Do not attribute specific wording or claims to
  texts that are not in the retrieved passages.
  - Mark the difference between what the passages directly say and what you are
  noticing or inferring. When you reach beyond the passages to an external work,
  name it by title and signal the shift, but do not quote it.
  - When you map a term across traditions, treat it as a *family resemblance*,
  not an equation — note where the overlap holds and where it breaks. Avoid
  false equivalences between traditions.
  - These are contemplative and philosophical texts, not medical, legal, or
  psychiatric advice.

ESSAY SHAPE:
  - Open by naming the cross-tradition tension or resonance directly — what is
  surprising or hard about putting these two side by side.
  - Develop it through the passages: let them lead, quote sparingly and
  purposefully, and hold genuine divergence open rather than flattening it.
  - Close with a thought that lands, not a teaser for a next instalment.
  - Write in markdown prose. Use paragraphs for the argument; lists only when
  genuinely enumerating.

Emit EXACTLY this structure so it can be parsed:

TITLE: <a specific, evocative title>
DEK: <one sentence that frames the parallel>

<the essay, in markdown prose>

CITATIONS:
[TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred/summary]
(one line per source passage you actually drew on)`;

// getBlogSystemPrompt composes the blog overlay + blog rules. No voice
// param — a single internal blog voice this phase (the blog_posts.voice
// column is reserved for future variants).
export function getBlogSystemPrompt(): string {
  return `${BLOG_OVERLAY}\n\n${BLOG_RULES}`;
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
    case "summary":
      return "§"; // generated study apparatus, not a scraped source (W0 decision)
    default:
      return "○";
  }
}

// Structural subset of the fields formatChunk reads — satisfied by both
// RetrievedChunk (query/blog paths) and AtlasChunk (atlas path), so the exact
// SOURCE PASSAGES formatting is shared by all three.
interface FormattableChunk {
  tradition: string;
  text_name: string;
  translator: string | null;
  section: string;
  body: string;
  tier?: string;
}

function formatChunk(chunk: FormattableChunk, index: number): string {
  // Tier is stated explicitly (TIER: verified), not only as the ◆/◇/○ glyph:
  // the glyph has no legend in the prompt, so a model emitting the CITATIONS
  // block (whose format ends `| TIER: …`) would otherwise have to *infer* each
  // passage's tier rather than copy it. The header now mirrors the citation
  // format so the tier is read, not guessed.
  const tier = chunk.tier ?? "inferred";
  const translator = chunk.translator ? ` (trans. ${chunk.translator})` : "";
  return (
    `[${index + 1}] ${tierSymbol(tier)} ${chunk.tradition} | ${chunk.text_name}${translator} | ${chunk.section} | TIER: ${tier}\n` +
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
  const passagesBlock = fitPassagesBlock(queryText, chunks, tier, reservedExtra);
  return `${passagesBlock}\n\n---\n\nQUERY: ${queryText}`;
}

// ---------------------------------------------------------------------------
// Study mode (summary-phase-w.md §W4)
// ---------------------------------------------------------------------------

/**
 * Render the WORK DOSSIER block. Apparatus, not source: the header instructs
 * the model to cite only SOURCE PASSAGES. Fields are compact by construction
 * (§1.1 token bands) and are never compressed — the passage budget shrinks
 * around them instead (buildStudyPrompt reserves the block's tokens).
 */
export function formatDossier(d: WorkDossier): string {
  const toc = d.structure
    .map(e => `- ${e.section_span} — ${e.title}`)
    .join("\n");
  const figures = d.key_figures
    .filter(f => f.name && (f.role || f.gloss))
    .map(f => `${f.name} (${f.role || f.gloss})`)
    .join("; ");
  const terms = d.key_terms
    .filter(t => t.term && t.gloss)
    .map(t => `${t.term} — ${t.gloss}`)
    .join("; ");
  const themes = d.themes
    .map(t => t.replace(/^concept\./, "").replace(/_/g, " "))
    .join(", ");

  const parts = [
    `WORK DOSSIER — ${d.work_label} (study apparatus, generated: for orientation only. ` +
      `Cite SOURCE PASSAGES, never this block.)`,
    `SUMMARY: ${d.summary}`,
    `CONTEXT: ${d.context}`,
    toc ? `STRUCTURE:\n${toc}` : null,
    figures ? `KEY FIGURES: ${figures}` : null,
    terms ? `KEY TERMS: ${terms}` : null,
    themes ? `THEMES: ${themes}` : null,
    d.reading_notes ? `READING NOTES: ${d.reading_notes}` : null,
  ];
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Study-mode variant of buildPrompt: prepends the pinned work's dossier
 * (when one exists) ahead of SOURCE PASSAGES. Missing dossier = no block,
 * never an error or placeholder (W0 finding 4 — coverage may be partial).
 * The dossier is budgeted like history via reservedExtra so passages fit
 * around it; the dossier itself is never compressed.
 */
export function buildStudyPrompt(
  queryText: string,
  chunks: RetrievedChunk[],
  dossier: WorkDossier | null,
  _prefs: UserPreferences,
  tier: "free" | "pro",
  reservedExtra = 0,
): string {
  const dossierBlock = dossier ? formatDossier(dossier) : null;
  const dossierTokens = dossierBlock ? estimateTokens(dossierBlock) : 0;

  const passagesBlock = fitPassagesBlock(
    queryText, chunks, tier, reservedExtra + dossierTokens);

  const blocks = dossierBlock
    ? [dossierBlock, passagesBlock]
    : [passagesBlock];
  return `${blocks.join("\n\n---\n\n")}\n\n---\n\nQUERY: ${queryText}`;
}

/** Shared budget→compress→fit→format core of buildPrompt/buildStudyPrompt —
 *  one drift point for chunk budgeting instead of two. */
function fitPassagesBlock(
  queryText: string,
  chunks: RetrievedChunk[],
  tier: "free" | "pro",
  reservedExtra: number,
): string {
  const budget = makeBudget(tier, reservedExtra);
  const targetPerChunk = Math.floor(
    budget.available / Math.max(chunks.length, 1),
  );
  const compressed = compressChunks(chunks, queryText, targetPerChunk);
  const fitted = budget.fitChunks(compressed);
  return fitted.length > 0
    ? `SOURCE PASSAGES:\n\n${fitted.map(formatChunk).join("\n\n")}`
    : "No source passages were found for this query.";
}

/**
 * Build the blog essay user-prompt from retrieved chunks and a concept pair.
 *
 * Mirrors buildPrompt's budget handling exactly (compress over-long chunks,
 * then fit to the window), but always budgets against the 'pro' tier (the
 * largest CONTEXT_WINDOWS entry — there is no user tier in the blog path)
 * and replaces the trailing QUERY with an essay brief naming the two
 * concepts (+ angle if present).
 */
export function buildBlogPrompt(
  conceptLabels: [string, string],
  definitions: string[],
  angle: string | null,
  chunks: RetrievedChunk[],
): string {
  const budget = makeBudget("pro");

  // Drive compression with the concept labels + angle so the kept sentences
  // are the ones most relevant to the parallel being essayed.
  const compressionQuery = [...conceptLabels, angle ?? ""].join(" ");
  const targetPerChunk = Math.floor(
    budget.available / Math.max(chunks.length, 1),
  );
  const compressed = compressChunks(chunks, compressionQuery, targetPerChunk);
  const fitted = budget.fitChunks(compressed);

  const passagesBlock =
    fitted.length > 0
      ? `SOURCE PASSAGES:\n\n${fitted.map(formatChunk).join("\n\n")}`
      : "No source passages were found for this parallel.";

  const [a, b] = conceptLabels;
  const defLines = definitions
    .map((d, i) =>
      d ? `- ${conceptLabels[i] ?? `concept ${i + 1}`}: ${d}` : null,
    )
    .filter(Boolean)
    .join("\n");
  const brief = [
    `ESSAY BRIEF: Trace the cross-tradition resonance between ${a} and ${b}.`,
    defLines ? `\nWorking definitions:\n${defLines}` : "",
    angle ? `\nAngle to pursue: ${angle}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `${passagesBlock}\n\n---\n\n${brief}`;
}

// buildBlogPromptFromTopic is the free-text seeding path (todo:bf1c07fb): the
// operator supplies a topic/prompt instead of a concept pair. Same SOURCE
// PASSAGES + budget handling as buildBlogPrompt; the trailing brief is the
// operator's topic verbatim rather than a named parallel.
export function buildBlogPromptFromTopic(
  topic: string,
  chunks: RetrievedChunk[],
): string {
  const budget = makeBudget("pro");
  const targetPerChunk = Math.floor(
    budget.available / Math.max(chunks.length, 1),
  );
  const compressed = compressChunks(chunks, topic, targetPerChunk);
  const fitted = budget.fitChunks(compressed);

  const passagesBlock =
    fitted.length > 0
      ? `SOURCE PASSAGES:\n\n${fitted.map(formatChunk).join("\n\n")}`
      : "No source passages were found for this topic.";

  const brief = `ESSAY BRIEF: Write a grounded essay on: ${topic.trim()}`;

  return `${passagesBlock}\n\n---\n\n${brief}`;
}

// ---------------------------------------------------------------------------
// State of the Atlas (recurring corpus-analysis essay)
// ---------------------------------------------------------------------------
//
// A different shape from a single-parallel blog post: the atlas essay reads the
// WHOLE corpus. Its quantitative claims come from a deterministic FACTS block
// (src/lib/atlas.ts) the model may not alter, and its grounding is the exemplar
// passages the analysis selected (not a semantic retrieval). It reuses the blog
// grounding/citation contract and the TITLE/DEK/CITATIONS output shape.

const ATLAS_OVERLAY = `You are a comparative-religion essayist writing "State of the Atlas" — a recurring,
data-led essay on an evolving catalog of cross-tradition esoteric resonances. You
do not trace a single parallel; you read the aggregate and say what the whole map
shows, with the restraint of a scholar who knows a map is not the territory.`;

// ATLAS_RULES keeps the blog grounding contract (no invented quotes, family
// resemblance not equation, citation block) and adds two atlas-specific
// disciplines: a mandatory methodology opening, and absolute fidelity to the
// supplied FACTS — the model narrates numbers, it never produces them.
const ATLAS_RULES = `You are given two things: a FACTS block (deterministic statistics computed
directly from the corpus) and SOURCE PASSAGES (the primary-text passages behind
the associations the FACTS summarize).

METHODOLOGY — OPEN WITH THIS, PLAINLY:
  - The associations are proposed by a language model tagging primary sources,
  then tier-rated; this essay rests on the 'verified' tier only.
  - The corpus is curated and additive, not a complete census of any tradition.
  - Edges carry no confidence weight — tier is the only quality signal.
  - Coverage is uneven: some traditions are far more represented than others, so
  raw centrality partly reflects sampling. Where the FACTS give a normalized
  figure (per-100-chunks), reason from it, and say why.
  Tell the reader what the instrument is before you tell them what it sees. Do
  not bury this as a footnote — it is the essay's frame.

FACTS DISCIPLINE:
  - Every number, ranking, and proportion you state MUST come from the FACTS
  block, verbatim. Do not compute new statistics, round differently, extrapolate,
  or invent a figure that is not given. If the FACTS don't support a quantitative
  claim, make it qualitatively or not at all.

GROUNDING (as in every essay here):
  - Every interpretive claim about what a passage says must be grounded in the
  SOURCE PASSAGES. Do not invent quotations or attribute wording to texts absent
  from the passages.
  - Treat every cross-tradition resonance as a *family resemblance*, not an
  equation. Foreground where likeness breaks, and give the divergences (the
  CONTRASTS) real weight — an essay that only shows convergence is advocacy, not
  analysis.
  - Distinguish what the data shows from what you are inferring about why.

ESSAY SHAPE:
  - Open with methodology, then the question the aggregate poses. Map the
  network (hubs vs. bridges), name the candidate universals — but read them in
  the concept hierarchy: when several near-universal concepts belong to one
  family (the FACTS give the domain → family → concept map), say so and treat the
  family as the unit, not the loose concepts. Then press on the long-range cases
  (resonance between traditions that never met — the hardest to explain by
  contact), then where it breaks. Close on implications held to the size of the
  evidence.
  - Markdown prose. Tables only where a ranking genuinely reads better as one.

Emit EXACTLY this structure so it can be parsed:

TITLE: <a specific title for this edition>
DEK: <one sentence framing what this edition of the atlas shows>

<the essay, in markdown prose>

CITATIONS:
[TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred/summary]
(one line per SOURCE PASSAGE you actually drew on)`;

export function getAtlasSystemPrompt(): string {
  return `${ATLAS_OVERLAY}\n\n${ATLAS_RULES}`;
}

/** Render the deterministic snapshot as a plain-text FACTS block. */
function formatFacts(s: AtlasSnapshot): string {
  const h = s.headline;
  const matrix = s.traditionMatrix
    .map(m => `  ${m.a} ↔ ${m.b}: ${m.parallels}`)
    .join("\n");
  const central = s.centrality
    .map(
      c =>
        `  ${c.tradition}: degree ${c.parallelDegree}, ${c.partnerTraditions} partner traditions, ${c.chunks} chunks, ${c.parallelsPer100Chunks} parallels/100 chunks`,
    )
    .join("\n");
  const bridges = s.bridgeConcepts
    .map(b => {
      const place = [b.domain, b.family].filter(Boolean).join(" › ");
      return `  ${b.label}${place ? ` (${place})` : ""}: ${b.traditions} traditions, ${b.mentions} mentions`;
    })
    .join("\n");
  const famBridges = s.familyBridges
    .map(f => `  ${f.label} (${f.domain}, ${f.concepts} concepts): ${f.traditions} traditions, ${f.mentions} mentions`)
    .join("\n");
  const hier = s.hierarchy
    .map(d => {
      const fams = d.families
        .map(f => `    ${f.label}: ${f.concepts.join(", ")}`)
        .join("\n");
      return `  ${d.domain}\n${fams}`;
    })
    .join("\n");
  const longRange = s.longRangeCases
    .map(l => `  ${l.a} ↔ ${l.b}: ${l.parallels} verified parallels`)
    .join("\n");
  const contrastList = s.contrasts
    .map(c => `  ${c.a.tradition} (${c.a.text_name}) ⟷ ${c.b.tradition} (${c.b.text_name}): ${c.annotation ?? "(no annotation)"}`)
    .join("\n");

  return [
    `FACTS (corpus snapshot as of ${s.generatedAt}, schema v${s.schemaVersion}):`,
    ``,
    `Scale: ${h.traditions} traditions, ${h.concepts} concepts in ${h.families} families, ` +
      `${h.parallelsVerified} verified cross-tradition parallels (+${h.parallelsProposed} proposed, not used here), ` +
      `${h.contrasts} explicit contrasts. All parallels are cross-tradition by construction.`,
    ``,
    `Top cross-tradition pairs (verified parallels):\n${matrix}`,
    ``,
    `Tradition centrality (raw degree AND normalized per-100-chunks — use the normalized figure to separate genuine reach from over-sampling):\n${central}`,
    ``,
    `Concept families by tradition-spread (the hierarchy's load-bearing clusters — several near-universal concepts are really facets of one family; read at this level before treating concepts as independent coincidences):\n${famBridges}`,
    ``,
    `Concepts by tradition-spread (candidate universals), shown as domain › family › concept:\n${bridges}`,
    ``,
    `Full concept map (domain → family → concepts):\n${hier}`,
    ``,
    `Long-range / low-contact pairs that still resonate (the hard cases):\n${longRange}`,
    ``,
    `Explicit contrasts (the corpus's curated divergences — the verified places traditions pull APART; the passages for these are in SOURCE PASSAGES, the annotation states how they diverge):\n${contrastList}`,
  ].join("\n");
}

/**
 * Build the atlas user-prompt: the FACTS block + a SOURCE PASSAGES block built
 * from the exemplar passages behind the long-range cases and contrasts (deduped
 * by chunk id, budgeted to the pro window), then the brief.
 */
export function buildAtlasPrompt(snapshot: AtlasSnapshot): string {
  const facts = formatFacts(snapshot);

  // Flatten exemplar + contrast passages, dedup by chunk id.
  const seen = new Set<string>();
  const passages: AtlasChunk[] = [];
  const push = (c: AtlasChunk) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    passages.push(c);
  };
  for (const lc of snapshot.longRangeCases) {
    for (const ex of lc.exemplars) { push(ex.a); push(ex.b); }
  }
  for (const ct of snapshot.contrasts) { push(ct.a); push(ct.b); }

  // Fit to the pro window, reserving room for the FACTS block + the response.
  const factsTokens = Math.ceil(facts.length / 4);
  const budget = makeBudget("pro", factsTokens);
  let used = 0;
  const fitted: AtlasChunk[] = [];
  for (const c of passages) {
    if (used + c.token_count > budget.available) break;
    used += c.token_count;
    fitted.push(c);
  }

  const passagesBlock =
    fitted.length > 0
      ? `SOURCE PASSAGES:\n\n${fitted.map((c, i) => formatChunk(c, i)).join("\n\n")}`
      : "No source passages were available for this snapshot.";

  const brief =
    `ESSAY BRIEF: Write this edition of "State of the Atlas". Narrate what the FACTS ` +
    `show about the structure of cross-tradition resonance, ground every interpretive ` +
    `claim in the SOURCE PASSAGES, and open with the methodology. Use ONLY the figures ` +
    `given in FACTS.`;

  return `${facts}\n\n---\n\n${passagesBlock}\n\n---\n\n${brief}`;
}
