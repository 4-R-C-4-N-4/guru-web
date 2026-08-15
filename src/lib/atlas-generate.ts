/**
 * src/lib/atlas-generate.ts
 *
 * "State of the Atlas" edition generator (todo:526a20c3). The composition half:
 * compute the deterministic snapshot (src/lib/atlas.ts), have the model write
 * grounded prose around it (never inventing a statistic), and store the result
 * as a DRAFT blog_posts row (seed_kind='atlas') for human review and publish.
 *
 * Unlike generateDraft it does NOT retrieve — the grounding passages are the
 * exemplars the analysis selected. It otherwise reuses the same pipeline tail
 * (model stream, parse, slug, cost, chunks_used) so editions render through the
 * existing public blog surface.
 */

import { one } from './db';
import { computeAtlasSnapshot, hasAnyParallels, type AtlasSnapshot, type AtlasChunk } from './atlas';
import { getAtlasSystemPrompt, buildAtlasPrompt } from './prompt';
import { completeStream } from './model';
import { parseGenerated } from './blog-generate';
import { uniqueSlug } from './slug';
import {
  resolveCuratedModel,
  isCuratedSlug,
  DEFAULT_CURATED_SLUG,
  type CuratedSlug,
} from './curated-models';
import { computeCost } from './cost';
import type { ChatMessage } from './history';

// Same empty-completion floor as the blog generator: a reasoning model can
// return finish=stop with no body. Never store an empty edition.
const MIN_BODY_CHARS = 200;

// An atlas edition is "in flight" while it's anything other than published or
// terminally closed. We refuse to mint a second one over an in-flight draft.
const IN_FLIGHT = ['queued', 'generating', 'draft', 'needs_attention'];

/**
 * A refusal the operator can act on (an edition already in flight, a corpus with
 * no evidence at all) — distinct from an unexpected/transient failure (LLM
 * error, empty completion). Callers map this to 409 and everything else to 500.
 */
export class AtlasRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtlasRefusal';
  }
}

export interface AtlasEditionResult {
  id: string;
  slug: string;
  editionNo: number;
  title: string;
  costUsd: number | null;
  snapshot: AtlasSnapshot;
}

/** The cited-passage set behind an edition (deduped) — drives the Sources block. */
function citedChunks(snapshot: AtlasSnapshot): AtlasChunk[] {
  const seen = new Set<string>();
  const out: AtlasChunk[] = [];
  const push = (c: AtlasChunk) => {
    if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
  };
  for (const lc of snapshot.longRangeCases) for (const ex of lc.exemplars) { push(ex.a); push(ex.b); }
  for (const ct of snapshot.contrasts) { push(ct.a); push(ct.b); }
  return out;
}

/**
 * Generate one "State of the Atlas" edition as a draft.
 *
 * @param generatedAt ISO timestamp stamped onto the snapshot (caller-supplied
 *   so the edition is reproducible/testable).
 * @param model curated slug to compose with (default: the blog default).
 * @param force mint a new edition even if one is already in flight.
 */
export async function generateAtlasEdition(opts: {
  generatedAt: string;
  model?: string;
  force?: boolean;
}): Promise<AtlasEditionResult> {
  const { generatedAt, force = false } = opts;

  // Grounding guard: refuse an essay with no evidence at all. Checked first,
  // cheaply, before the dup-guard and the full snapshot computation — an
  // empty or freshly-deployed corpus shouldn't pay for 8 parallel queries
  // plus the long-range-case loop just to be told there was nothing to say.
  if (!(await hasAnyParallels())) {
    throw new AtlasRefusal('atlas: no parallels in the corpus — refusing to generate.');
  }

  // Dup-guard: don't stack drafts.
  if (!force) {
    const inFlight = await one<{ id: string; edition_no: number | null }>(
      `SELECT id, edition_no FROM blog_posts
        WHERE seed_kind='atlas' AND status = ANY($1) LIMIT 1`,
      [IN_FLIGHT],
    );
    if (inFlight) {
      throw new AtlasRefusal(
        `An atlas edition is already in flight (id ${inFlight.id}, №${inFlight.edition_no ?? '?'}). ` +
        `Review/publish or reject it first, or pass force to override.`,
      );
    }
  }

  // Next edition number across all atlas rows.
  const maxRow = await one<{ next: number }>(
    `SELECT COALESCE(MAX(edition_no), 0) + 1 AS next FROM blog_posts WHERE seed_kind='atlas'`,
  );
  const editionNo = Number(maxRow?.next ?? 1);

  // Deterministic analysis. Grounding guard already ran above (hasAnyParallels).
  const snapshot = await computeAtlasSnapshot(generatedAt);

  const slugStr = isCuratedSlug(opts.model ?? '') ? (opts.model as CuratedSlug) : DEFAULT_CURATED_SLUG;
  const modelId = resolveCuratedModel(slugStr);

  const messages: ChatMessage[] = [
    { role: 'system', content: getAtlasSystemPrompt() },
    { role: 'user', content: buildAtlasPrompt(snapshot) },
  ];

  // Collect the stream to completion (no UI). Mirrors blog-generate.
  const stream = await completeStream(messages, modelId, slugStr);
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
      cachedTok = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0;
    }
  }

  const fallbackTitle = `State of the Atlas №${editionNo}`;
  const { title: parsedTitle, dek, body } = parseGenerated(raw, fallbackTitle);
  if (body.trim().length < MIN_BODY_CHARS) {
    throw new Error(`atlas: empty generation (${body.trim().length} chars < ${MIN_BODY_CHARS}).`);
  }

  // Canonical, stable title + slug for the almanac; the model's title becomes a subtitle.
  const title =
    parsedTitle && !/state of the atlas/i.test(parsedTitle)
      ? `State of the Atlas №${editionNo}: ${parsedTitle}`
      : fallbackTitle;
  const slug = await uniqueSlug(`state of the atlas no ${editionNo}`);

  let cost: number | null = null;
  if (inTok !== null && outTok !== null) {
    try {
      cost = (await computeCost({ modelId, inputTokens: inTok, outputTokens: outTok, cachedInputTokens: cachedTok })).cost_usd;
    } catch (e) {
      console.error('[atlas-generate] cost compute failed:', e);
    }
  }

  const used = citedChunks(snapshot).map(c => ({
    id: c.id, tradition: c.tradition, text_name: c.text_name, section: c.section, tier: c.tier,
  }));

  const row = await one<{ id: string }>(
    `INSERT INTO blog_posts
       (status, seed_kind, model, edition_no, title, slug, dek, content,
        chunks_used, atlas_snapshot, cost_usd, created_by)
     VALUES ('draft', 'atlas', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'atlas-generator')
     RETURNING id`,
    [slugStr, editionNo, title, slug, dek || null, body,
     JSON.stringify(used), JSON.stringify(snapshot), cost],
  );
  if (!row) throw new Error('atlas: INSERT returned no row');

  return { id: row.id, slug, editionNo, title, costUsd: cost, snapshot };
}
