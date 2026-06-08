/**
 * src/lib/blog-generate.ts
 *
 * Generator core for the grounded blog pipeline (BRD §1, IMPL T3).
 *
 * generateDraft(seedId) turns one `queued` blog_posts seed (a cross-tradition
 * concept pair) into a `draft` — or parks it in `needs_attention` when the
 * retrieval is too thin to ground an essay or anything throws.
 *
 * HARD RULES (IMPL):
 *   1. This is the AUTONOMY SEAM. It imports nothing route- or
 *      request-scoped — no Request, requireUser, headers(), or budget. It
 *      takes a seedId, reads/writes the DB, and calls the RAG chain. The
 *      manual API route (T4) and a future systemd timer are both just
 *      callers of this same function.
 *   2. The GROUNDING GUARD short-circuits BEFORE any LLM call: a thin
 *      retrieval lands the row in needs_attention with no generation, no
 *      silent fallback to the model's own knowledge.
 *   3. Blog generation is OFF the user budget — there is no user. It records
 *      cost_usd per post for observability only; it never reserves/finalises
 *      spend.
 */

import { query, one, exec } from './db';
import { parseCitationsBlock } from './citations';
import { uniqueSlug } from './slug';
import { retrieve } from './retriever';
import { getBlogSystemPrompt, buildBlogPrompt, buildBlogPromptFromTopic } from './prompt';
import { completeStream } from './model';
import {
  resolveCuratedModel,
  isCuratedSlug,
  DEFAULT_CURATED_SLUG,
} from './curated-models';
import { computeCost } from './cost';
import type { ChatMessage } from './history';
import type { RetrievedChunk, UserPreferences } from './types';

// Grounding floor — below this many retrieved chunks we do not generate an
// essay (HARD RULE 2). 4 mirrors the spec; tune via the eval harness later.
const MIN_CHUNKS = 4;

// Generation floor — a parsed essay body shorter than this is treated as an
// empty/failed completion (a reasoning model can return finish=stop with no
// content). Such a row is parked in needs_attention, never saved as a draft.
const MIN_BODY_CHARS = 200;

// The seed row as generateDraft reads it. Mirrors the blog_posts columns the
// generator consumes (migration 013); the write columns it sets are inlined
// in the UPDATEs below.
interface SeedRow {
  id: string;
  status: string;
  topic: string | null;
  concept_ids: string[] | null;
  angle: string | null;
  model: string;
  scope_mode: string;
  blocked_traditions: string[] | null;
  blocked_texts: string[] | null;
  whitelisted_traditions: string[] | null;
  whitelisted_texts: string[] | null;
}

interface ConceptRow {
  id: string;
  label: string;
  definition: string | null;
}

/**
 * Turn one queued seed into a draft (or needs_attention). Idempotent-ish:
 * a seed that is not `queued` is a no-op so a double-fire (manual button +
 * a future timer, say) can't double-generate.
 */
export async function generateDraft(seedId: string): Promise<void> {
  const seed = await one<SeedRow>(
    `SELECT id, status, topic, concept_ids, angle, model, scope_mode,
            blocked_traditions, blocked_texts,
            whitelisted_traditions, whitelisted_texts
       FROM blog_posts WHERE id = $1`,
    [seedId],
  );
  if (!seed || seed.status !== 'queued') return; // guard double-fire

  await exec(
    `UPDATE blog_posts SET status='generating', updated_at=now() WHERE id=$1`,
    [seedId],
  );

  try {
    // 1. Resolve the seeding mode into a retrieval queryText, a deferred
    //    user-prompt builder (needs the retrieved chunks), and a fallback
    //    title. Mode A = free-text topic; Mode B = cross-tradition concept
    //    pair. The XOR between topic and concept_ids is enforced at the seed
    //    route; here, a present topic wins.
    const prefs = seedToPrefs(seed);
    let queryText: string;
    let fallbackTitle: string;
    let buildUserPrompt: (chunks: RetrievedChunk[]) => string;

    if (seed.topic && seed.topic.trim()) {
      // Mode A — free-text topic.
      const topic = seed.topic.trim();
      queryText = topic;
      fallbackTitle = topic.slice(0, 80);
      buildUserPrompt = chunks => buildBlogPromptFromTopic(topic, chunks);
    } else {
      // Mode B — concept pair. Load labels/definitions, ordered to match
      //   seed.concept_ids so the [a, b] pairing the brief uses is stable.
      const ids = seed.concept_ids ?? [];
      const conceptRows = await query<ConceptRow>(
        `SELECT id, label, definition FROM concepts WHERE id = ANY($1)`,
        [ids],
      );
      const concepts = ids
        .map(id => conceptRows.find(c => c.id === id))
        .filter((c): c is ConceptRow => Boolean(c));
      if (concepts.length < 2) {
        await fail(seedId, `concept pair not found: ${ids.join(', ')}`);
        return;
      }
      const labels: [string, string] = [concepts[0].label, concepts[1].label];
      const definitions = concepts.map(c => c.definition ?? '');
      queryText = buildQueryText(concepts, seed.angle);
      fallbackTitle = concepts.map(c => c.label).join(' & ');
      buildUserPrompt = chunks => buildBlogPrompt(labels, definitions, seed.angle, chunks);
    }

    // 2. Retrieve + GROUNDING GUARD (HARD RULE 2: before any LLM call).
    const chunks = await retrieve(queryText, prefs);
    if (chunks.length < MIN_CHUNKS) {
      await fail(
        seedId,
        `thin retrieval: ${chunks.length} chunks (< ${MIN_CHUNKS})`,
      );
      return;
    }

    // 3. Resolve the model from the seed slug (fall back to default for a
    //    stale/invalid slug rather than throwing).
    const slug = isCuratedSlug(seed.model) ? seed.model : DEFAULT_CURATED_SLUG;
    const modelId = resolveCuratedModel(slug);

    const messages: ChatMessage[] = [
      { role: 'system', content: getBlogSystemPrompt() },
      { role: 'user', content: buildUserPrompt(chunks) },
    ];

    // 4. Collect the stream to completion — no UI to stream to. Mirrors the
    //    usage/cached-token handling in api/query/route.ts.
    const stream = await completeStream(messages, modelId, slug);
    let raw = '';
    let inTok: number | null = null;
    let outTok: number | null = null;
    let cachedTok = 0;
    for await (const chunk of stream) {
      raw += chunk.choices[0]?.delta?.content ?? '';
      if (chunk.usage) {
        inTok = chunk.usage.prompt_tokens ?? null;
        outTok = chunk.usage.completion_tokens ?? null;
        const u = chunk.usage as {
          prompt_tokens_details?: { cached_tokens?: number };
          cache_read_input_tokens?: number;
        };
        cachedTok =
          u.prompt_tokens_details?.cached_tokens ??
          u.cache_read_input_tokens ??
          0;
      }
    }

    // 5. Parse the structured head, strip the CITATIONS tail, derive a slug.
    const { title, dek, body } = parseGenerated(raw, fallbackTitle);

    // Thin-GENERATION guard (companion to the thin-retrieval guard at step 3).
    // A reasoning model can return finish=stop with an empty content body (all
    // tokens spent on hidden reasoning, or an upstream blip). parseGenerated
    // falls back to a concept-label title, so without this check an empty essay
    // would be saved as a publishable draft. Park it in needs_attention instead
    // — same principle as Hard Rule 2: never persist empty output as a draft.
    if (body.trim().length < MIN_BODY_CHARS) {
      await fail(seedId, `empty generation: ${body.trim().length} chars (< ${MIN_BODY_CHARS})`);
      return;
    }

    const slugStr = await uniqueSlug(title);

    // 6. Cost is best-effort: observability only (HARD RULE 3), never fails
    //    the draft. Mirrors api/query/route.ts.
    let cost: number | null = null;
    if (inTok !== null && outTok !== null) {
      try {
        cost = (
          await computeCost({
            modelId,
            inputTokens: inTok,
            outputTokens: outTok,
            cachedInputTokens: cachedTok,
          })
        ).cost_usd;
      } catch (e) {
        console.error('[blog-generate] cost compute failed:', e);
      }
    }

    // 7. Store the RICHER chunks_used shape. queries.chunks_used stores bare
    //    IDs (api/query/route.ts); blog posts store {id, tradition, text_name,
    //    section, tier} so the public Sources block and the draft grounding
    //    review render without a corpus join and survive a corpus re-import.
    //    We deliberately read only these five fields, so the wider hybrid
    //    RetrievedChunk shape (source/lexRank/conceptMatchWeight) is ignored.
    const used = chunks.map((c: RetrievedChunk) => ({
      id: c.id,
      tradition: c.tradition,
      text_name: c.text_name,
      section: c.section,
      tier: c.tier ?? 'inferred',
    }));

    await exec(
      `UPDATE blog_posts
          SET status='draft', title=$2, slug=$3, dek=$4, content=$5,
              chunks_used=$6, cost_usd=$7, error_note=NULL, updated_at=now()
        WHERE id=$1`,
      [seedId, title, slugStr, dek || null, body, JSON.stringify(used), cost],
    );
  } catch (err) {
    await fail(seedId, err instanceof Error ? err.message : String(err));
  }
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Map a seed row's scope columns into the UserPreferences shape retrieve()
 * reads. retrieve only consults scope fields; preferredModel/preferredVoice
 * are placeholders (the blog path resolves its model from the seed slug
 * directly, and has no voice).
 */
export function seedToPrefs(seed: SeedRow): UserPreferences {
  const mode =
    seed.scope_mode === 'whitelist' || seed.scope_mode === 'blacklist'
      ? seed.scope_mode
      : 'all';
  return {
    scopeMode: mode,
    blockedTraditions: seed.blocked_traditions ?? [],
    blockedTexts: seed.blocked_texts ?? [],
    whitelistedTraditions: seed.whitelisted_traditions ?? [],
    whitelistedTexts: seed.whitelisted_texts ?? [],
    preferredModel: null,
    preferredVoice: 'scholar',
  };
}

/** The retrieval query for a parallel: both concept labels (+ angle). */
export function buildQueryText(
  concepts: ConceptRow[],
  angle: string | null,
): string {
  const labels = concepts.map(c => c.label).join(' and ');
  return angle ? `${labels} — ${angle}` : labels;
}

/**
 * Pull TITLE:/DEK: from the structured head and strip the CITATIONS: block
 * from the body. A missing head never blocks a draft: title falls back to the
 * caller-supplied `fallbackTitle` (concept labels for a pair seed, the topic
 * text for a free-text seed), dek to the first paragraph. The CITATIONS block
 * is dropped from the stored body (it's reconstructed from chunks_used on render).
 */
export function parseGenerated(
  raw: string,
  fallbackTitle: string,
): { title: string; dek: string; body: string } {
  const text = raw.trim();

  const titleMatch = text.match(/^\s*TITLE:\s*(.+?)\s*$/m);
  const dekMatch = text.match(/^\s*DEK:\s*(.+?)\s*$/m);

  // Body = everything after the DEK/TITLE head, with the CITATIONS tail removed.
  let body = text;
  // Drop the head lines (TITLE:/DEK:) if present.
  body = body.replace(/^\s*TITLE:.*$/m, '').replace(/^\s*DEK:.*$/m, '');
  // Strip the CITATIONS block (shared parser — the one CITATIONS regex).
  body = parseCitationsBlock(body).body;

  const title = (titleMatch?.[1] ?? fallbackTitle).trim() || fallbackTitle;

  const firstPara = body.split(/\n\s*\n/)[0]?.trim() ?? '';
  const dek = (dekMatch?.[1] ?? firstPara).trim();

  return { title, dek, body };
}


/** Park a seed in needs_attention with a diagnostic note (never a partial draft). */
async function fail(seedId: string, note: string): Promise<void> {
  await exec(
    `UPDATE blog_posts
        SET status='needs_attention', error_note=$2, updated_at=now()
      WHERE id=$1`,
    [seedId, note],
  );
}
