# BRD — Grounded Blog Pipeline (Manual Phase)

The site needs a stream of public, discoverable content to drive
inbound interest. The corpus already holds the raw material for it:
hand-curated `concepts`, and `PARALLELS` edges between them (520 today)
that express the one thing guru does that nobody else does —
cross-tradition synthesis. A `PARALLELS` edge between a Gnostic concept
and a Kabbalist one *is* a blog post's thesis, sitting in the database
waiting to be written.

This BRD specifies a pipeline that turns those seeds into grounded
essays through the existing RAG chain, behind a two-gate human review
flow. It reuses the retrieve → buildPrompt → completeStream machinery
wholesale; the blog generator is a new *caller* of that chain, not a
second pipeline.

**This phase is manual.** An admin adds seeds to the queue, fires
generation by hand ("a few before leaving it to its own devices"),
reviews drafts, and publishes. The autonomy (a scheduled generator) is designed *in* —
the generator is decoupled from its trigger so autonomy is a second
caller, not a rewrite — but is explicitly deferred (§9).

Out of scope for this phase: any change to `/api/query`, the chat
voices, the retriever, or the spend/quota system. Blog generation runs
its own path and does not touch user-facing budgets.

---

## 1 Decision summary

1. **Two gates, not one.** A *pre-generation* gate (the queue: an admin
   greenlights what gets written before any tokens are spent) and a
   *post-generation* gate (drafts: an admin approves the prose before it
   goes public). The pre-gate is the cost control; the post-gate is the
   quality control. This mirrors the apply-gate philosophy already in
   guru-review (nothing goes live without a human click).

2. **One table, status-driven lifecycle.** A single `blog_posts` table
   carries a row from seed to published via a `status` column. A queued
   row is a *seed only* (no content); generation fills it in and advances
   it to `draft`.

   ```
   queued → generating → draft → published
                            ↘ rejected / archived
      (generation failed / thin retrieval) → needs_attention
   ```

3. **The generator is a lib function, decoupled from its trigger.**
   `generateDraft(seedId)` in `src/lib/blog-generate.ts` turns one seed
   into one draft and has no knowledge of who called it. In this phase an
   admin button calls it. The deferred autonomy phase (§9) adds a second
   caller (a systemd timer running a batch script) and changes nothing
   else.

4. **Every post is grounded; no fallbacks.** Generation runs `retrieve()`
   exactly as chat does. If retrieval comes back thin or empty for a seed,
   the generator sets `status='needs_attention'` with an `error_note` and
   stops — it never pads the essay from the model's own memory. This is
   the same no-silent-fallback rule the rest of the app holds to. Every
   draft stores its `chunks_used` (same shape as `queries.chunks_used`) so
   the prose is auditable against its sources.

5. **A hidden essayist voice.** Generation uses a new system-prompt
   overlay built the same way as the chat voices in `src/lib/prompt.ts`
   (`VOICE_OVERLAY` + `CORE_RULES`), but it is *not* added to the
   user-facing `VoiceSlug` union (`src/lib/types.ts`) and never appears in
   the settings picker. It lives behind its own door
   (`getBlogSystemPrompt`) so the user-facing voice type stays clean and
   needs no guard against users selecting it.

6. **Public blog pages are server-rendered.** `/blog` and `/blog/[slug]`
   render on the server, deliberately unlike the client-hydrated chat —
   the entire point is SEO and discovery.

7. **Per-seed model and scope, fully configurable.** Each seed carries a
   curated-model slug (all options exposed; defaults to `deepseek`) and a
   scope config mirroring pro-mode preferences (`scope_mode` +
   tradition/text lists). Seeds are always concept **pairs** — a
   cross-tradition parallel — never single concepts in this phase.

---

## 2 Why this is not a hack

The blog generator reuses the platform's native interface end to end.
It is the *fourth* caller of the same `retrieve → buildPrompt →
completeStream` chain (after chat, and notionally any future caller),
not a parallel implementation. The seeds come from the corpus's own
`edges` table, the grounding guarantee is the same one chat enforces,
and the human gates are the same apply-gate pattern guru-review already
runs. Nothing here invents a new mechanism; it composes existing ones.

The two-gate structure is the deliberate part. Generate-then-review
alone would spend tokens on every candidate and review after. Adding the
pre-generation queue means an admin only spends budget on topics already
worth writing — and, in this phase, only when they click.

---

## 3 Why not the alternatives

**Auto-publish (no draft gate).** Rejected. Publishing ungrounded LLM
prose to a public research site is the one failure mode that damages
credibility, and it cuts against both the guru-review apply gate and the
no-fallbacks principle. Drafts always wait for a human.

**Generate everything, review after (no queue gate).** Rejected for this
phase. It spends generation budget on topics that may never publish. The
queue gate makes spend a deliberate act. (The autonomy phase relaxes
this by letting a capped batch generate from the queue — but still only
from greenlit seeds.)

**Free-form topic prompts (ungrounded seeds).** Rejected as the primary
path. The differentiator is corpus-grounded cross-tradition synthesis;
seeding from `concepts` / `PARALLELS` edges keeps every post traceable to
real chunks and gives a finite, high-quality backlog. Admin-authored
custom seeds are allowed (§5.1) but they still feed retrieval and obey
the same grounding guard — the angle steers *which* grounded material is
emphasised, it does not license invention.

**Single-concept essays.** Rejected for this phase. A concept without a
cross-tradition counterpart is an encyclopedia entry; the parallels are
the content. Seeds are pairs only — drive for the parallel every time.

**Overloading `VoiceSlug` with a blog voice.** Rejected. It would force
a guard against users selecting a non-conversational voice in settings
and muddy a type that today cleanly means "user-facing chat persona." A
separate `getBlogSystemPrompt` reuses the overlay *idea* without
widening the user-facing union.

**A scheduled generator now.** Deferred, not rejected (§9). The admin
wants to fire a few by hand first and judge quality before automating.
The design makes the later switch cheap.

---

## 4 The lifecycle

A `blog_posts` row moves through `status`:

| status           | meaning                                                        | set by                          |
|------------------|----------------------------------------------------------------|---------------------------------|
| `queued`         | seed greenlit, awaiting generation. No content yet.            | admin (custom seed)             |
| `generating`     | `generateDraft` in flight. Guards against double-fire.         | `generateDraft` start           |
| `draft`          | content produced, awaiting publish decision.                   | `generateDraft` success         |
| `needs_attention`| retrieval too thin to ground a post, or generation errored.    | `generateDraft` guard / failure |
| `published`      | live on `/blog`.                                               | admin publish                   |
| `rejected`       | draft declined.                                                | admin reject                    |
| `archived`       | retired (unpublished, or queue item abandoned).                | admin                           |

In this phase `generating` is brief (synchronous generation, §6) but it
is a real persisted state so a double-click can't fire two generations,
and so the autonomy phase's batch runner has a state to claim.

---

## 5 Code changes

### 5.1 Schema — `migrations/013_blog_posts.sql` (new)

Raw SQL, matching the existing migration style (numbered, `pg`, no ORM;
latest today is `012_chat_voice.sql`). Fields chosen so the autonomy
phase needs no schema churn:

```sql
CREATE TABLE blog_posts (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- seed
    status        TEXT NOT NULL DEFAULT 'queued',
    seed_kind     TEXT NOT NULL,            -- 'candidate' | 'custom'
    concept_ids   TEXT[] NOT NULL,          -- exactly two: the parallel being explored
    edge_ref      TEXT,                      -- "<source>|<target>|<edge_type>" when promoted from a candidate
    angle         TEXT,                      -- optional admin framing/lens
    voice         TEXT,                      -- optional override; defaults to the blog voice
    model         TEXT NOT NULL DEFAULT 'deepseek',  -- curated-model slug; any of the curated options

    -- scope (mirrors user_preferences; configures retrieval reach per seed)
    scope_mode             TEXT NOT NULL DEFAULT 'all',  -- 'all' | 'whitelist' | 'blacklist'
    blocked_traditions     TEXT[],
    blocked_texts          TEXT[],
    whitelisted_traditions TEXT[],
    whitelisted_texts      TEXT[],

    priority      INTEGER,                   -- nullable; ignored in manual phase, ordering key for autonomy
    created_by    TEXT,                      -- operator email (admin is the synthetic tailnet operator, not a users row — no FK)

    -- output (null until generated)
    title         TEXT,
    slug          TEXT UNIQUE,
    content       TEXT,
    chunks_used   JSONB,                     -- provenance, same shape as queries.chunks_used
    cost_usd      NUMERIC(10, 6),
    error_note    TEXT,                      -- why needs_attention / generation failed

    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    published_at  TIMESTAMPTZ
);

CREATE INDEX idx_blog_posts_status ON blog_posts(status, created_at DESC);
CREATE INDEX idx_blog_posts_published ON blog_posts(published_at DESC) WHERE status = 'published';
```

`slug` is `UNIQUE` but nullable — only set at generation time. (The
corpus-derived candidate feed and its `concept_ids` / `edge_ref` dedup are
dropped this phase — see the IMPL "Corrections" §4 and Open Questions;
seeds are operator-authored pairs. The same parallel may legitimately be
revisited from a different angle, so there is intentionally no DB-level
pair-uniqueness constraint either way.) The `seed_kind` / `edge_ref`
columns stay (reserved) so the candidate path can return without a
migration.

### 5.2 Generator core — `src/lib/blog-generate.ts` (new)

```ts
export async function generateDraft(seedId: string): Promise<void>
```

The seam. Knows nothing about its caller. Steps:

1. Load the seed row; set `status='generating'` (guard: no-op if not
   `queued`).
2. Build `queryText` from the concept label(s) + `definition` + `angle`.
   For a concept *pair*, frame the parallel explicitly.
3. `retrieve(queryText, prefs)` where `prefs` is built from the seed's own
   scope config (`scope_mode` + blocked/whitelisted traditions/texts) —
   the exact `UserPreferences` shape the retriever already takes. Defaults
   to `scope_mode: 'all'` (maximum cross-tradition reach) but is
   configurable per seed, the same way a pro user scopes their own queries.
4. **Grounding guard.** If the retrieved set is empty or below a chunk /
   token floor, set `status='needs_attention'` + `error_note`, return.
   No generation.
5. `getBlogSystemPrompt(voice)` (§5.3) + a blog prompt builder over the
   retrieved chunks.
6. Resolve the curated model from the seed's `model` slug (any of the
   curated options; defaults to `deepseek`) via the existing
   `resolveCuratedModel` path, and collect `completeStream(messages,
   modelId, slug)` to completion — aggregate the stream, no UI. Read the
   usage chunk for `cost_usd` via the existing `computeCost` path.
7. Parse a title from the output (or derive from concept labels),
   generate a unique `slug`, write `title` / `slug` / `content` /
   `chunks_used` / `cost_usd`, advance to `status='draft'`.

On any thrown error: `status='needs_attention'`, `error_note` set, never
a partial draft.

### 5.3 Hidden voice — `src/lib/prompt.ts`

- Add a blog overlay alongside `VOICE_OVERLAY` and a sibling rule block.
  The chat `CORE_RULES` are written for a single-turn *reply* ("a thread
  the user can pull on"); the blog rules want essay shape (open /
  develop / close) while keeping the invariant grounding and citation
  rules.
- Export `getBlogSystemPrompt(voice)` — the same `overlay + rules`
  assembly as `getSystemPrompt`, behind its own name.
- A `buildBlogPrompt(...)` (or a parameterised `buildPrompt`) lays out the
  retrieved chunks for an essay rather than a Q&A turn.
- **No change to `VoiceSlug` in `src/lib/types.ts`.** The blog voice is
  internal.

### 5.4 Admin API — `src/app/api/admin/blog/` (new)

Thin routes, admin-guarded via the existing `requireAdmin` path:

- `POST /api/admin/blog/seed` — add a seed to the queue. Body carries a
  concept **pair** (`concept_ids`, length 2), the chosen `model` (any
  curated slug), a scope config (`scope_mode` + blocked/whitelisted lists),
  and an optional `angle`. `seed_kind` is `'custom'` this phase; the
  corpus-derived `'candidate'` variant (with `edge_ref`) is deferred — see
  §10.6.
- `POST /api/admin/blog/[id]/generate` — calls `generateDraft(id)`
  **synchronously**. Admin-only and low-volume, so holding the request
  open for the generation duration is acceptable. "Fire off a few" = a
  few clicks. (The async/background variant is part of the autonomy phase,
  not before it.)
- `POST /api/admin/blog/[id]/publish` — set `status='published'`,
  `published_at=now()`.
- `POST /api/admin/blog/[id]/reject` and `/archive`.

### 5.5 Admin UI — `src/app/(admin)/admin/blog/` (new)

Mirrors the existing admin list pages (`users`, `queries`, `sessions`):
list + detail, `tokens` styling, no Tailwind. Three views:

- **Queue** — `status='queued'` seeds. Per-row **"Generate"** button (the
  manual fire). Editable / removable. Hosts the **"add seed"** form — the
  sole seeding entry this phase — which carries a concept pair, a **model
  picker exposing all curated options** (`deepseek` / `xai` / `anthropic`
  / `openai`), a **scope selector mirroring the pro settings page** (reuse
  the existing scope / model preference components rather than rebuilding
  them), and an optional `angle`.
- **Drafts** — `status='draft'` rows, prose rendered with the existing
  `react-markdown` + `MD_COMPONENTS`, with `chunks_used` shown alongside
  so grounding is verifiable at a glance. **Publish / Reject.** Also
  surfaces `needs_attention` rows with their `error_note`.
- **Published** — `status='published'`, with **Unpublish / archive**.

(A corpus-derived **Candidates** view — auto-proposing ranked `PARALLELS`
pairs to seed from — was specced but **dropped**: the live corpus has no
`DERIVES_FROM` edges and `edges.weight` is unpopulated, leaving nothing to
rank by beyond `tier`. Deferred until `edges.weight` lands — see §10.6 and
the IMPL doc's Open Questions. The operator still seeds cross-tradition
parallels; they just pick the pair by hand in the seed form.)

### 5.6 Public pages — `src/app/blog/` (new)

- `/blog` — server-rendered index of `status='published'` rows, newest
  first, title + excerpt cards.
- `/blog/[slug]` — server-rendered post. Reuses `react-markdown` +
  `MD_COMPONENTS` and the `Citation` component
  (`src/components/citation.tsx`); a "sources" section renders
  `chunks_used`. `tokens` styling throughout. No new frontend deps.

---

## 6 Synchronous generation (this phase)

The manual generate button runs `generateDraft` inline and returns when
the draft exists. This is intentional for an admin-only, low-volume
action: it is the simplest correct thing, gives immediate feedback, and
needs no job queue or polling. The cost is a request held open for the
generation duration (seconds to ~a minute), which is fine off the
user-facing path.

The async/background execution (enqueue, return immediately, poll
status) is deliberately deferred to land *with* the autonomy phase,
where batch generation makes it worth the complexity. The `generating`
status already exists to support it.

---

## 7 Done when

- `migrations/013_blog_posts.sql` applies cleanly via the existing
  migrate path; `blog_posts` exists with the lifecycle statuses and
  indexes.
- `generateDraft(seedId)` turns a queued seed into a `draft` row with
  `content`, `chunks_used`, and `cost_usd` populated — verified against a
  real concept/parallel seed.
- The grounding guard works: a seed whose retrieval is empty/thin lands
  in `needs_attention` with an `error_note` and produces **no** content.
- `getBlogSystemPrompt` exists; `VoiceSlug` is unchanged; the blog voice
  never appears in the settings picker.
- Admin can: add a seed (a cross-tradition concept pair) with an angle,
  model, and scope, fire generation by hand, see the draft with its
  sources, and publish.
- `/blog` and `/blog/[slug]` render published posts server-side with
  citations; an unpublished slug 404s.
- `tsc --noEmit` clean; new lib functions unit-tested (seed → queryText
  assembly, grounding guard, slug uniqueness).

---

## 8 Risks

- **Hallucination past the grounding guard.** The guard ensures chunks
  exist; it does not guarantee the prose stays faithful to them. Mitigated
  by the draft gate (a human reads every post) and by rendering
  `chunks_used` beside the draft for spot-checking. The blog `CORE_RULES`
  carry the same no-invented-quotes constraint as chat.
- **Synchronous request duration.** A slow model could hold the admin
  request open long enough to hit a proxy/server timeout. Acceptable at
  admin volume; if it bites, it is the trigger to bring the deferred async
  path forward.
- **Generation cost is off-budget.** Blog generation bypasses the
  user spend/quota system by design (no user). `cost_usd` is recorded per
  post for observability, but nothing *enforces* a cap in this phase —
  the manual fire is the cap. A per-run budget cap belongs to the
  autonomy phase.
- **Stale seeds.** A corpus re-import can change concepts/edges under a
  queued seed. Acceptable — seeds store their own `concept_ids` and
  generation re-retrieves at fire time, so a seed is never silently bound
  to stale corpus state.

---

## 9 Deferred — the autonomy phase (designed-in, not built)

Switching to autonomous generation adds, and *only* adds:

- `scripts/generate-blog.ts` — selects `status='queued'` rows by
  `priority` then age, calls the existing `generateDraft()` on each, stops
  at a per-run count / cost cap.
- `deploy/generate-blog.timer` + `deploy/generate-blog.service` — the
  third copy of the `sync-pricing` systemd-timer pattern
  (`deploy/sync-pricing.{timer,service}` + `scripts/sync-pricing.ts` run
  via `tsx`).
- Optionally: candidate auto-promotion (top-N unpublished parallels flow
  into the queue automatically) — itself gated on populated `edges.weight`
  (§10.6), since without it there is no ranking signal beyond `tier`.
- The async/background generate path (§6) if batch sizes warrant it.

Unchanged by the switch: the `blog_posts` schema, `generateDraft`, the
draft → publish human gate, and the public pages. That invariance is the
whole reason for the trigger/generator split in §1.4.

---

## 10 Resolved decisions

These were the open questions at design time; all are now settled.

1. **Model — configurable, all options exposed.** Not a fixed blog
   default. Each seed picks any curated model (`deepseek` / `xai` /
   `anthropic` / `openai`) via a picker, alongside a **scope selector
   mirroring pro mode**. Default is `deepseek` (it performs well); the
   full spread exists precisely so the models can be benchmarked against
   each other on real posts.

2. **Excerpt — model emits it.** The dek is part of the generated output,
   not a truncated first paragraph.

3. **Pairs only.** Seeds are always a concept pair (a cross-tradition
   parallel). No single-concept essays in this phase — the parallels are
   the on-brand content and there is no current reason to write singles.

4. **Slug collisions — suffix a counter.** KISS; never block a good draft
   on a name clash.

5. **BRD → IMPL.** This BRD is the design. The companion
   `IMPL-blog-pipeline.md` (the ticket breakdown: migration, generator
   core, voice, admin API, admin UI, public pages, in dependency order)
   is the first todoing step.

6. **Corpus-derived candidate auto-proposal — deferred (2026-05-27).**
   Originally a **Candidates** view would surface ranked `PARALLELS` /
   `DERIVES_FROM` pairs to seed from. A live-corpus check found **zero**
   `DERIVES_FROM` edges and `edges.weight` `NULL` on all 520 `PARALLELS`
   (the corpus producer's `export.py` hardcodes `weight=None`), so the
   ranking has no signal beyond `tier`. The feature is dropped for the
   manual phase — seeds are operator-authored pairs (still cross-tradition
   parallels, just chosen by hand). The `seed_kind` / `edge_ref` columns
   stay reserved so it returns without a migration. Revisit when
   `edges.weight` is populated; see the IMPL doc's Open Questions.
