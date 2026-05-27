# Implementation Plan — Grounded Blog Pipeline (Manual Phase)

Companion to `BRD-blog-pipeline.md`. The BRD answers *what* and *why*;
this doc answers *which tickets, in what order, with what scope*.

Each numbered section below becomes a `todo` once the parent feature
ticket exists. The work is larger than a single PR, so it groups into
three (see "Phasing" at the end): **core** (T1–T3), **admin surface**
(T4–T7), **public + verify** (T8–T9). Main is protected — each PR
ships from a `todo/<id>` branch for the operator to open.

---

## Corrections to the BRD discovered during file review

The BRD was written before reading every touched file. Four of its
claims need adjusting; this doc is authoritative where they conflict:

1. **`created_by` is not a FK to `users`.** Admin runs behind the
   tailnet Caddy listener and `requireAdmin()` returns a *synthetic*
   operator (`src/lib/admin.ts:41` — `id: 'tailnet'`, `email:
   'admin@tailnet'`), not a real `users` row. `created_by` is a plain
   `TEXT` column holding the operator email. (BRD §5.1 fixed.)

2. **The settings scope/model selectors are inline JSX, not reusable
   components.** `src/app/(app)/settings/page.tsx` builds them inline and
   fetches the catalog from the `requireUser`-gated `/api/corpus`. The
   BRD's "reuse the existing components" (§5.5) is therefore not literal —
   T6 extracts them, and the admin context fetches the catalog
   server-side instead of via `/api/corpus`.

3. **`MD_COMPONENTS` is local to `chat-view.tsx`** (`src/components/
   chat-view.tsx:74`), not exported — and it is a **static** module-level
   const that does **not** vary on `mobile` (the `mobile`-conditional
   sizing lives in chat-view's surrounding layout JSX, not in the
   component map). T5 extracts it as a plain const so both chat and the
   public blog page render markdown identically. (The earlier
   `getMarkdownComponents(mobile)` framing was wrong — and the blog page is
   a server component that couldn't pass a `useIsMobile()` value anyway.)

4. **No `DERIVES_FROM` edges exist, and `edges.weight` is unpopulated, so
   the corpus-derived candidate feed is dropped this phase.** Verified live
   2026-05-27: the corpus holds **520 `PARALLELS` edges** (159 verified /
   361 proposed) but **zero `DERIVES_FROM`**, and `weight` is `NULL` on
   every row (`export.py` hardcodes `weight=None`). A ranked "Candidates"
   surface would therefore have nothing to rank by beyond `tier`, and one
   of its two intended edge sources is empty. **Decision:** drop the
   auto-proposed Candidates view for the manual phase; seeds are
   operator-authored (custom) pairs. The cross-tradition-parallel thesis
   (BRD §1, §3) is unchanged — the operator still seeds parallels, just by
   hand instead of from a ranked list. The `seed_kind` / `edge_ref`
   columns stay in the schema (reserved) so the candidate path can return
   cheaply once `edges.weight` is populated (see Open Questions).

---

## Hard rules

**Rule 1 — `generateDraft` never imports anything route- or
request-scoped.** It is the autonomy seam (BRD §1.3). It takes a
`seedId`, reads/writes the DB, and calls `retrieve` / `getBlogSystemPrompt`
/ `buildBlogPrompt` / `completeStream` / `computeCost`. No `Request`, no
`requireUser`, no `headers()`. If it ever needs one of those, the seam
is broken.

**Rule 2 — the grounding guard short-circuits before generation, not
after.** A thin/empty retrieval must land the row in `needs_attention`
*without* an LLM call (BRD §1.4, §4-`needs_attention`). No silent
fallback to the model's own knowledge — same principle as
`api/corpus/route.ts`'s "client must NOT substitute a fallback."

**Rule 3 — blog generation is off the user budget.** `generateDraft`
does **not** call `reserveBudget` / `finalizeBudget` (`src/lib/spend.ts`).
There is no user. It records `cost_usd` per post for observability and
nothing more (BRD §8). Do not thread a fake user through the spend path.

**Rule 4 — admin write routes are new ground.** Today every
`/api/admin/*` route is read-only (`src/app/api/admin/users/route.ts` is
representative: a `GET` behind `requireAdmin`). The blog routes are the
first *mutating* admin endpoints. They still gate on `requireAdmin()` and
still 404 (not 401/403) on failure, matching `src/lib/admin.ts:67`.

---

## Parent ticket

```
feat: grounded blog pipeline (manual phase)
type:  feature
tags:  blog, admin, rag, content
file:  docs/blog-pipeline/BRD-blog-pipeline.md
```

Implements BRD §1 manual phase. Autonomy (scheduled generation, batch
script + systemd timer, candidate auto-promotion) is deferred per BRD §9.
Closes when all child tickets close and the manual verification (T9)
passes.

---

## T1. Migration — `blog_posts` table

```
type:  chore
tags:  blog, db, migration
file:  migrations/013_blog_posts.sql
```

**Scope.** One new table, status-driven lifecycle, no other module
touched. Pure additive migration.

**Files:**

- `migrations/013_blog_posts.sql` (new). Follow the house style exactly:
  numbered after `012_chat_voice.sql`, `IF NOT EXISTS` so re-runs are
  no-ops (the `deploy.sh` contract is `psql -1 -v ON_ERROR_STOP=1`, see
  `012_chat_voice.sql:22-24`), no `CHECK` constraints (validate in app
  code, mirroring the `preferred_voice` / `preferred_model` precedent at
  `012_chat_voice.sql:18-20`).

  ```sql
  CREATE TABLE IF NOT EXISTS blog_posts (
      id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

      status        TEXT NOT NULL DEFAULT 'queued',
      seed_kind     TEXT NOT NULL,            -- 'candidate' | 'custom'
      concept_ids   TEXT[] NOT NULL,          -- exactly two: the parallel
      edge_ref      TEXT,                      -- "<source>|<target>|<edge_type>"
      angle         TEXT,
      voice         TEXT,                      -- reserved; one blog voice in this phase
      model         TEXT NOT NULL DEFAULT 'deepseek',

      scope_mode             TEXT NOT NULL DEFAULT 'all',
      blocked_traditions     TEXT[],
      blocked_texts          TEXT[],
      whitelisted_traditions TEXT[],
      whitelisted_texts      TEXT[],

      priority      INTEGER,
      created_by    TEXT,                      -- operator email; no FK (synthetic tailnet operator)

      title         TEXT,
      slug          TEXT UNIQUE,
      content       TEXT,
      chunks_used   JSONB,
      cost_usd      NUMERIC(10, 6),
      error_note    TEXT,

      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now(),
      published_at  TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_blog_posts_status
      ON blog_posts(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_blog_posts_published
      ON blog_posts(published_at DESC) WHERE status = 'published';
  ```

  `pgcrypto`/`gen_random_uuid()` is already relied on by
  `sessions`/`queries` (`migrations/002`), so no extension step is needed.

**Done when:**

- `npm run migrate` (`scripts/migrate.ts:24-40` runs every `migrations/
  *.sql` in filename order) applies cleanly and is a no-op on re-run.
- `\d blog_posts` in `psql` shows the columns + both indexes.

**Tests:** none (schema only). The generator's tests (T3) exercise it.

**Operator action post-merge.** Runs automatically via `deploy.sh`'s
migrate step. No manual action.

**Depends on:** nothing. Lands first.

**Blocks:** T3, T4.

---

## T2. Hidden essayist voice + blog prompt builder

```
type:  chore
tags:  blog, prompt, voice
file:  src/lib/prompt.ts
```

**Scope.** Add the blog system prompt and a blog prompt builder alongside
the chat ones, reusing the layered overlay+rules pattern and the existing
chunk formatter. **No change to `VoiceSlug`** (`src/lib/types.ts:35`) — the
blog voice is internal and never user-selectable (BRD §1.5, §3).

**Files:**

- `src/lib/prompt.ts`:
  - Add a `BLOG_OVERLAY` string and a `BLOG_RULES` string next to
    `VOICE_OVERLAY` (`prompt.ts:36-44`) and `CORE_RULES`
    (`prompt.ts:46-78`). `BLOG_RULES` keeps the invariant grounding /
    no-invented-quotes / register-signalling rules verbatim from
    `CORE_RULES`, but **replaces** the single-turn closer
    (`prompt.ts:66-71`, "a beat that opens the next turn") with essay
    shape: a title, a one-sentence dek, an opening that states the
    cross-tradition tension, development, and a close. It must instruct
    the structured head so the generator can parse it:

    ```
    TITLE: <a specific, evocative title>
    DEK: <one sentence that frames the parallel>

    <the essay, in markdown prose>

    CITATIONS:
    [TRADITION | TEXT | SECTION | TIER: verified/proposed/inferred]
    ```
  - Export `getBlogSystemPrompt(): string` mirroring `getSystemPrompt`
    (`prompt.ts:80-82`) — `return \`${BLOG_OVERLAY}\n\n${BLOG_RULES}\`;`.
    No `voice` param (single blog voice this phase; the `blog_posts.voice`
    column is reserved for future variants).
  - Export `buildBlogPrompt(conceptLabels: [string, string], definitions:
    string[], angle: string | null, chunks: RetrievedChunk[]): string`.
    Reuse the internal `formatChunk` (`prompt.ts:101-108`), `makeBudget`,
    and `compressChunks` exactly as `buildPrompt` (`prompt.ts:122-146`)
    does, but the trailing instruction replaces `QUERY: ...` with an essay
    brief naming the two concepts (+ angle if present). Budget against the
    `'pro'` tier (largest `CONTEXT_WINDOWS` entry) — there is no user tier.

**Done when:**

- `getBlogSystemPrompt()` returns overlay+rules; the rules retain the
  grounding/citation invariants and carry the `TITLE:`/`DEK:` contract.
- `buildBlogPrompt(...)` emits a `SOURCE PASSAGES` block (reusing
  `formatChunk`) followed by an essay brief, and respects the budget
  (fewer chunks when the budget is tight, like `buildPrompt`).
- `VoiceSlug` and `getSystemPrompt` are unchanged; `tsc --noEmit` clean.

**Tests:** `src/__tests__/prompt.test.ts` (extend) — `getBlogSystemPrompt`
contains the grounding rule and the `TITLE:` contract; `buildBlogPrompt`
includes both concept labels and the angle, and drops chunks when given a
tiny budget.

**Operator action post-merge.** None.

**Depends on:** nothing (pure string/format logic).

**Blocks:** T3.

---

## T3. Generator core — `generateDraft(seedId)`

```
type:  feature
tags:  blog, rag, generation
file:  src/lib/blog-generate.ts
```

**Scope.** The seam (Hard rule 1). Turns one `queued` seed into a `draft`
(or `needs_attention`). Reuses the RAG chain wholesale. No HTTP, no
trigger knowledge.

**Files:**

- `src/lib/blog-generate.ts` (new). Shape:

  ```ts
  import { query, one, exec } from './db';
  import { retrieve } from './retriever';
  import { getBlogSystemPrompt, buildBlogPrompt } from './prompt';
  import { completeStream, MAX_OUTPUT_TOKENS } from './model';
  import { resolveCuratedModel, isCuratedSlug, DEFAULT_CURATED_SLUG } from './curated-models';
  import { computeCost } from './cost';
  import type { ChatMessage } from './history';
  import type { RetrievedChunk, UserPreferences } from './types';

  const MIN_CHUNKS = 4; // grounding floor — below this, no essay

  export async function generateDraft(seedId: string): Promise<void> {
    const seed = await one<SeedRow>(`SELECT * FROM blog_posts WHERE id = $1`, [seedId]);
    if (!seed || seed.status !== 'queued') return; // guard double-fire

    await exec(`UPDATE blog_posts SET status='generating', updated_at=now() WHERE id=$1`, [seedId]);

    try {
      // 1. concept labels/definitions for the pair
      const concepts = await query<{ id: string; label: string; definition: string | null }>(
        `SELECT id, label, definition FROM concepts WHERE id = ANY($1)`, [seed.concept_ids],
      );
      // 2. scope prefs straight off the seed row (retrieve only reads scope fields)
      const prefs = seedToPrefs(seed);
      const queryText = buildQueryText(concepts, seed.angle);

      // 3. retrieve + GROUNDING GUARD (Hard rule 2: before any LLM call)
      const chunks = await retrieve(queryText, prefs);
      if (chunks.length < MIN_CHUNKS) {
        await fail(seedId, `thin retrieval: ${chunks.length} chunks (< ${MIN_CHUNKS})`);
        return;
      }

      // 4. build messages + resolve model from the seed slug
      const slug = isCuratedSlug(seed.model) ? seed.model : DEFAULT_CURATED_SLUG;
      const modelId = resolveCuratedModel(slug);
      const messages: ChatMessage[] = [
        { role: 'system', content: getBlogSystemPrompt() },
        { role: 'user',   content: buildBlogPrompt(/* labels, defs, angle */, chunks) },
      ];

      // 5. collect the stream to completion (no UI; mirrors route.ts:234-262)
      const stream = await completeStream(messages, modelId, slug);
      let raw = '', inTok: number | null = null, outTok: number | null = null, cachedTok = 0;
      for await (const chunk of stream) {
        raw += chunk.choices[0]?.delta?.content ?? '';
        if (chunk.usage) { inTok = chunk.usage.prompt_tokens ?? null; outTok = chunk.usage.completion_tokens ?? null;
          const u = chunk.usage as { prompt_tokens_details?: { cached_tokens?: number }; cache_read_input_tokens?: number };
          cachedTok = u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0; }
      }

      // 6. parse TITLE/DEK, strip CITATIONS block, derive a unique slug
      const { title, dek, body } = parseGenerated(raw, concepts);
      const slugStr = await uniqueSlug(title);

      // 7. cost (best-effort; never fails the draft — mirrors route.ts:289-291)
      let cost: number | null = null;
      if (inTok !== null && outTok !== null) {
        try { cost = (await computeCost({ modelId, inputTokens: inTok, outputTokens: outTok, cachedInputTokens: cachedTok })).cost_usd; }
        catch (e) { console.error('[blog-generate] cost compute failed:', e); }
      }

      // 8. store structured chunks_used (richer than queries — see note) + advance
      const used = chunks.map(c => ({ id: c.id, tradition: c.tradition, text_name: c.text_name, section: c.section, tier: c.tier ?? 'inferred' }));
      await exec(
        `UPDATE blog_posts SET status='draft', title=$2, slug=$3, content=$4,
           chunks_used=$5, cost_usd=$6, error_note=NULL, updated_at=now() WHERE id=$1`,
        [seedId, title, slugStr, body, JSON.stringify(used), cost],
      );
    } catch (err) {
      await fail(seedId, err instanceof Error ? err.message : String(err));
    }
  }
  ```

  Helpers in the same file: `seedToPrefs(seed): UserPreferences` (map the
  seed's `scope_mode` + `blocked_*`/`whitelisted_*` arrays into the
  `UserPreferences` shape from `types.ts:37-58`; `preferredModel`/
  `preferredVoice` are unused by `retrieve` so set placeholders),
  `buildQueryText(concepts, angle)`, `parseGenerated(raw, concepts)`
  (pull `TITLE:`/`DEK:` from the head, strip the `CITATIONS:` block from
  the body; fall back to a concept-label title / first-paragraph dek so a
  missing head never blocks a draft), `uniqueSlug(title)` (slugify;
  on collision append `-2`, `-3`, … per BRD §10.4 — KISS), and
  `fail(seedId, note)` (`UPDATE … SET status='needs_attention',
  error_note=$2`).

  **`chunks_used` divergence (intentional).** `queries.chunks_used` stores
  bare IDs (`route.ts:321` — `chunks.map(c => c.id)`). Blog posts store the
  richer `{id, tradition, text_name, section, tier}` objects so the public
  page's Sources block and the draft grounding-review render without a
  corpus join, and survive a corpus re-import. Note this in a comment.

**Done when:**

- A `queued` seed for a real concept pair becomes a `draft` with
  `title`, `slug`, `content` (no raw `CITATIONS:` block), structured
  `chunks_used`, and `cost_usd`.
- A seed whose retrieval yields `< MIN_CHUNKS` lands in `needs_attention`
  with an `error_note` and **no** `content` and **no** LLM call (assert
  `completeStream` is not invoked).
- A thrown error anywhere lands `needs_attention`, never a partial draft.
- Re-firing a non-`queued` seed is a no-op.
- No import of `requireUser`, `headers`, `reserveBudget`, or `Request`
  (Hard rules 1, 3). `tsc --noEmit` clean.

**Tests:** `src/__tests__/blog-generate.test.ts` (new), mocking `retrieve`,
`completeStream`, and the DB helpers (match the mocking style in
`src/__tests__/api.test.ts`):
- thin retrieval → `needs_attention`, `completeStream` never called;
- happy path → `draft` with parsed title/dek, stripped citations,
  structured `chunks_used`;
- slug collision → suffixed slug;
- missing `TITLE:`/`DEK:` → derived fallbacks, still a `draft`;
- `computeCost` throw → `draft` persists with `cost_usd` null.

**Operator action post-merge.** None (no caller yet; T4 wires the button).

**Depends on:** T1 (table), T2 (prompt).

**Blocks:** T4.

---

## T4. Admin server queries + mutating API routes

```
type:  feature
tags:  blog, admin, api
file:  src/lib/admin-blog.ts
```

**Scope.** The data layer + the admin HTTP surface. First mutating
`/api/admin/*` routes (Hard rule 4).

**Files:**

- `src/lib/admin-blog.ts` (new) — server query helpers (mirror
  `src/lib/admin-queries.ts` structure):
  - `listPosts(status)` — `SELECT … FROM blog_posts WHERE status = $1 ORDER
    BY created_at DESC` for the queue / drafts / published tabs.
  - `getPost(id)`, `listCorpusCatalog()` — the latter runs the same
    `SELECT DISTINCT tradition, text_name FROM chunks …` as
    `api/corpus/route.ts` so the admin seed form gets the catalog
    **server-side** (it cannot call the `requireUser`-gated `/api/corpus`).
  - `insertSeed(seed)`, `setStatus(id, status, fields)` write helpers.

- `src/app/api/admin/blog/seed/route.ts` (new) — `POST`, `requireAdmin`
  first (pattern from `api/admin/users/route.ts:24-26`). Validate: a
  two-element `concept_ids`, `model` via `isCuratedSlug`
  (`curated-models.ts:57`), a `scope_mode` in the allowed set. Insert a
  `queued` row (`seed_kind='custom'`), `created_by = operator.email`
  (`admin.ts:43`).
- `src/app/api/admin/blog/[id]/generate/route.ts` (new) — `POST`,
  `requireAdmin`, then `await generateDraft(id)` **synchronously** (BRD §6),
  return the resulting row. Admin-only, low volume — holding the request
  open is fine.
- `src/app/api/admin/blog/[id]/publish/route.ts`, `…/reject/route.ts`,
  `…/archive/route.ts` (new) — `POST`, `requireAdmin`, `setStatus`. Publish
  sets `published_at = now()`.

**Done when:**

- All five routes 404 without the tailnet trust header (dev bypass via
  `admin.ts:62` keeps local dev working), and act correctly with it.
- `POST /seed` rejects a non-pair `concept_ids` or unknown `model` slug
  (400) and otherwise inserts a `queued` row.
- `POST /[id]/generate` runs `generateDraft` and returns the `draft` (or
  `needs_attention`) row.
- publish/reject/archive transition status; publish stamps `published_at`.
- `tsc --noEmit` clean.

**Tests:** `src/__tests__/admin-blog.test.ts` (new) — `seed` validation
rejects non-pairs and bad slugs; `generate` delegates to a mocked
`generateDraft`.

**Operator action post-merge.** None.

**Depends on:** T1, T3.

**Blocks:** T7.

---

## T5. Extract `MD_COMPONENTS` to a shared module

```
type:  chore
tags:  blog, markdown, refactor
file:  src/lib/markdown.tsx
```

**Scope.** Lift the markdown renderer out of `chat-view.tsx` so the public
blog page renders identically. Behaviour-preserving refactor.

**Files:**

- `src/lib/markdown.tsx` (new) — export the markdown component map
  currently at `chat-view.tsx:74-114` as a plain const:
  `export const MD_COMPONENTS: Components = { … }`. That object is a
  *static* module-level const — it does **not** vary on `mobile` (all the
  `mobile`-conditional sizing is in chat-view's surrounding layout JSX, not
  the component map), so there is no `mobile` param and no factory.
- `src/components/chat-view.tsx` — delete the local `MD_COMPONENTS`
  (`:74-114`) and import the shared const instead; the `ReactMarkdown`
  usage at `:395-399` is unchanged. `remark-gfm` stays wired by the caller.

**Done when:**

- `chat-view.tsx` imports the shared const; no visual change to chat
  (the object is identical).
- `tsc --noEmit` clean; existing chat behaviour unchanged.

**Tests:** none (pure extraction); covered by chat's existing render path
and the T8 blog page.

**Operator action post-merge.** None.

**Depends on:** nothing.

**Blocks:** T8.

---

## T6. Extract `ScopeSelector` + `ModelPicker` for reuse

```
type:  chore
tags:  blog, settings, refactor
file:  src/components/scope-selector.tsx
```

> **Decision needed before starting (flagged in the BRD review).** Two
> ways to give the seed form a "scope selector like pro mode":
>
> - **(A) Extract** the inline scope tree + model radio from
>   `settings/page.tsx` into presentational components that take the
>   tradition/text `catalog` and current value as **props** (no
>   self-fetching), then have settings pass the `/api/corpus` result and
>   the admin form pass the server-fetched catalog. Single source of
>   truth; touches settings.
> - **(B) Rebuild** a simpler scope control inside the admin seed form,
>   accept duplication, leave settings untouched. Faster, lower risk to a
>   working page, but two copies drift.
>
> This ticket specs **(A)** as the recommended path. If the operator
> prefers (B), this ticket collapses into part of T7 and settings is not
> touched.

**Scope (option A).** Decouple render from fetch for the scope tree and
model radio in `settings/page.tsx`, extract presentational components,
re-wire settings to pass data in as props.

**Files:**

- `src/components/scope-selector.tsx` (new) — `<ScopeSelector catalog
  value onChange />` where `catalog: Record<string, { texts: string[] }>`
  (the `/api/corpus` shape) and `value` is the `scope_mode` +
  blocked/whitelisted arrays. Lift the tradition→text tree JSX from
  `settings/page.tsx` (the scope section the explorer located at
  ~`:326-393`).
- `src/components/model-picker.tsx` (new) — `<ModelPicker value onChange
  disabled? />` over `CURATED_MODELS` (`curated-models.ts:21-26`), lifting
  the radio group from `settings/page.tsx` (~`:189-257`).
- `src/app/(app)/settings/page.tsx` — replace the inline blocks with the
  new components; it keeps fetching `/api/corpus` and passes the result in
  as `catalog`. Net behaviour identical.

**Done when:**

- Settings page renders and saves exactly as before (manual smoke: toggle
  a tradition, change model, reload — persisted).
- Both components are pure/presentational (catalog + value in, change out;
  no internal fetch).
- `tsc --noEmit` clean.

**Tests:** none beyond the settings manual smoke; these are presentational.

**Operator action post-merge.** None.

**Depends on:** nothing.

**Blocks:** T7.

---

## T7. Admin UI — `/admin/blog`

```
type:  feature
tags:  blog, admin, ui
file:  src/app/(admin)/admin/blog/page.tsx
```

**Scope.** The three-view editorial surface (Queue, Drafts, Published).
Server components for reads
(matching the existing admin pages — `force-dynamic`, server-side fetch
via lib helpers, no client `/api/admin` fetches for reads); small client
components for the **actions** (the first mutating admin UI, Hard rule 4).

**Files:**

- `src/app/(admin)/layout.tsx` — add a nav entry. After the `Users`
  `NavItem` (`layout.tsx:69`):
  ```tsx
  <NavItem href="/admin/blog">Blog</NavItem>
  ```
- `src/app/(admin)/admin/blog/page.tsx` (new) — server component,
  `export const dynamic = 'force-dynamic'` (per `layout.tsx:22` /
  `users/page.tsx`). Tabs via `searchParams.tab` (`queue` | `drafts` |
  `published`, default `queue`). Fetch the matching helper from
  `admin-blog.ts` server-side; render with `DataTable` /
  `StatTile` from `src/components/admin/` (the explorer confirmed these are
  the reusable list primitives). Drafts tab renders body via the shared
  `MD_COMPONENTS` (T5) with the `chunks_used` shown beside it; also
  surfaces `needs_attention` rows + `error_note`.
- `src/app/(admin)/admin/blog/seed-form.tsx` (new, client) — the "add
  seed" form (the sole seeding entry this phase): concept-pair pickers,
  `<ModelPicker>` + `<ScopeSelector>` (T6, fed the server-passed catalog),
  angle field. `POST`s to `/api/admin/blog/seed`, then refreshes.
- `src/app/(admin)/admin/blog/actions.tsx` (new, client) — the
  per-row action buttons (Generate / Publish / Reject / Archive) that
  `POST` to the T4 routes and refresh. Generate shows an in-flight state
  while the synchronous request runs (BRD §6).

**Done when:**

- The seed form posts a valid pair + model + scope and the row appears
  in the Queue tab.
- Queue "Generate" runs the post end to end and it moves to Drafts (or
  surfaces in needs_attention).
- Drafts show prose + sources; Publish moves a draft to Published; Reject
  / Archive work.
- `/admin/blog` 404s without the tailnet trust header (inherits the
  layout's `requireAdmin`).

**Tests:** none automated for the pages (consistent with the existing
admin pages, which have no page-level tests); covered by T9 manual
verification. Logic lives in T3/T4, which are tested.

**Operator action post-merge.** None.

**Depends on:** T4, T5, T6.

**Blocks:** T9.

---

## T8. Public pages — `/blog` and `/blog/[slug]`

```
type:  feature
tags:  blog, public, seo
file:  src/app/blog/page.tsx
```

**Scope.** Server-rendered public index + post pages. No auth (Hard fact:
`proxy.ts` runs Clerk as a pass-through; a page that never calls
`requireUser` is public, like the landing page). No middleware change.

**Files:**

- `src/lib/blog-public.ts` (new) — `listPublished()` and
  `getPublishedBySlug(slug)`: `SELECT … FROM blog_posts WHERE status =
  'published' …`, newest first (covered by `idx_blog_posts_published`).
- `src/app/blog/page.tsx` (new) — server component. Index of published
  posts: title + dek cards, linking to `/blog/[slug]`. `tokens` styling
  (`src/styles/tokens.ts`).
- `src/app/blog/[slug]/page.tsx` (new) — server component. Fetch by slug;
  `notFound()` if absent or not `published`. Render `content` via the
  shared `MD_COMPONENTS` (T5) + `remark-gfm`. Render a **Sources**
  section mapping `chunks_used` → `<Citation tradition text=text_name
  section tier />` (`src/components/citation.tsx`; note `text` prop ←
  `text_name`, no `quote`). Add `generateMetadata` returning title + dek
  for SEO.

**Done when:**

- `/blog` lists only `published` posts, newest first.
- `/blog/<slug>` renders a published post with markdown body + sources; an
  unknown or unpublished slug 404s.
- Pages render signed-out (verified in an incognito/no-Clerk session).
- `generateMetadata` populates `<title>` and description.
- `tsc --noEmit` clean.

**Tests:** `src/__tests__/blog-public.test.ts` (new) — `getPublishedBySlug`
returns null for a draft slug; `listPublished` excludes non-published.

**Operator action post-merge.** None. (Optional: add `/blog` to the
sitemap if one exists — check `src/app/sitemap.ts`; out of scope if absent.)

**Depends on:** T1, T5.

**Blocks:** T9.

---

## T9. Manual verification (gating step, no code)

```
type:  chore
tags:  blog, verification, manual-test
file:  docs/blog-pipeline/BRD-blog-pipeline.md
```

**Scope.** Drive the whole manual pipeline once on staging/local before
closing the parent.

**Procedure:**

1. On the tailnet admin surface, open `/admin/blog` → Queue. Add a seed
   for a known cross-tradition parallel pair (default model/scope).
2. Add a second seed (a different pair) with an angle, a non-default
   model, and a narrowed scope.
3. Fire **Generate** on both. Confirm one or both reach Drafts; inspect a
   draft's prose against its Sources block for grounding.
4. Force the grounding guard: seed a pair you expect to retrieve little
   (or temporarily raise `MIN_CHUNKS`) → confirm `needs_attention` +
   `error_note`, no content.
5. Publish a good draft.
6. Visit `/blog` signed-out → the post is listed; open it → body +
   sources render; an unpublished slug 404s.

**Done when:** all six hold; `cost_usd` is populated on the generated
drafts (spot-check in the drafts view).

**Operator action post-merge.** None.

**Depends on:** T7, T8.

---

## Phasing

Three PRs off `todo/<id>` branches:

- **PR 1 — core (T1, T2, T3).** Migration, blog voice/prompt, generator.
  Fully unit-tested, no UI, no user-facing surface. Safe to land and sit.
- **PR 2 — admin surface (T4, T5, T6, T7).** Data layer, mutating admin
  routes, markdown + selector extractions, the `/admin/blog` views. T6's
  A-vs-B decision (settings refactor vs rebuild) is settled before this PR
  starts.
- **PR 3 — public + verify (T8, T9).** Public pages + the end-to-end
  manual gate. Closes the parent.

Within each PR, commit per ticket for reviewer hygiene. The autonomy
phase (BRD §9) is a *separate* future feature — `scripts/generate-blog.ts`
+ `deploy/generate-blog.{timer,service}` calling the unchanged
`generateDraft` — and gets its own BRD/IMPL when it earns the work.

---

## Open questions

### Deferred — revisit when the corpus-candidate path comes back

These were specced, then dropped per Correction §4. The schema already
carries `seed_kind` / `edge_ref` so the path can return without a
migration.

1. **Corpus-derived candidate auto-proposal.** Bring back `listCandidates`
   + a ranked **Candidates** tab (verified-first, then weight) once
   `edges.weight` is populated. That is cross-repo work in the corpus
   producer (`export.py` currently hardcodes `weight=None`; tracked at
   `todo:9f401f76`, gated on the retrieval eval harness). Until then a
   ranked feed has only `tier` (3 buckets) to sort 520 `PARALLELS` by — not
   worth the surface area.

2. **Seed-form dedup.** With no candidates query there is no longer
   anything stopping two seeds for the same concept pair. Low stakes (a
   parallel can legitimately be revisited from a new angle), but if it
   bites, add a soft "already seeded" warning in the seed form using the
   old predicate — `concept_ids @> ARRAY[a,b]::text[]` over rows not in
   `archived` / `rejected`.

3. **`DERIVES_FROM` / `CONTRASTS` as seed sources.** The live corpus has
   **zero** `DERIVES_FROM` edges and only **8** `CONTRASTS` (vs 520
   `PARALLELS`). If the corpus grows these, they could widen the backlog
   beyond same-direction parallels.

4. **Autonomy phase (BRD §9).** Scheduled generation + batch script +
   systemd timer. Now *doubly* gated: it needs the autonomy work itself
   **and** — for its optional candidate auto-promotion — populated
   `edges.weight` (item 1).

### Still active — needed for PR 2 (not deferred)

- **T6 — extract (A) vs rebuild (B) the scope/model selectors.** Still
  needs an operator decision before PR 2 starts; see the T6 decision
  block. The plan recommends (A).
