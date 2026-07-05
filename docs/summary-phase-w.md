# Phase W — Document-Knowledge Layer, guru-web side

Companion to the guru repo's `docs/summary/document-knowledge-data-structures.md`
(design) and `docs/summary/implementation-guru.md` (G1–G7, complete on guru's
`feature/summary`). This document covers everything guru-web needs to consume
the v4 corpus: schema pairing, boot bump, study mode (greenfield), dossier
injection, and the summary retrieval leg.

## W0 — Vetting results (2026-07-04, against a live v4 load)

The current v4 artifact (2 pilot dossiers, 10 summary nodes — L1 generation
for the full corpus is running as this is written) was loaded into a scratch
pgvector Postgres and the intended runtime queries were run for real. Verdict:
**the curated surface is sufficient — every consumption path works — with one
provable gap in scope filtering that W3 must fix.**

Proven:

1. **Dossier fetch is PK-shaped and member-transparent.** Pinning any member
   text resolves through `texts.work_id` to its work's dossier:
   `SELECT d.* FROM texts t JOIN work_dossiers d ON d.work_id = t.work_id
   WHERE t.id = $1` — verified: pinning `gnostic-john-baptizer-2` returns the
   grouped work's dossier with its 8-entry structure.
2. **Every `formatChunk`/`RetrievedChunk` column is derivable** for summary
   rows with two COALESCEs and two joins (works + texts):
   `text_name := COALESCE(texts.label, works.label)` (the works fallback
   covers multi-member L2 rows where `text_id IS NULL`),
   `section := COALESCE(section_span, 'Whole work')`,
   `translator := NULL`, `text_id := COALESCE(text_id, work_id)` (the
   `RetrievedChunk.text_id` field is non-nullable).
3. **THE GAP — `buildScopeFilter` cannot be applied verbatim to
   summary_nodes**, contrary to the design doc's §2 note. Its text-level
   conditions compare `text_id`, and in SQL `NULL <> ALL(array)` is NULL, so
   **multi-member L2 rows silently vanish under any blacklist with a
   text-level entry — even when the blocked text is unrelated.** Demonstrated
   live: blocking `kalevala` (unrelated) returned 8 of 9 expected summary
   rows; the `gnostic-john-baptizer` L2 was the silent casualty. Whitelist
   mode inverts the failure (NULL never matches ANY → grouped L2s excluded
   from every text-whitelist). The fix (also verified live): apply text-level
   scope to summaries via **works membership overlap** —
   `w.member_text_ids && $n::text[]` (whitelist: require overlap; blacklist:
   `NOT (… && …)`). Tradition-level conditions apply verbatim (every work is
   single-tradition).
4. **Missing dossier = no block.** Coverage is 2/52 during the pilot;
   Q1 returns zero rows for undossiered works and the runtime must render
   study mode without the block (design §3.3) — W4 treats the empty result
   as normal.

Design decision (CONFIRMED 2026-07-04): summary rows carry `tier: 'summary'`
— `formatChunk` would otherwise mislabel them `inferred`. W3 extends
`tierSymbol`/the citation legend accordingly. (Noted for later: the tier
system is under-implemented in practice — worth its own pass someday, out of
Phase W scope.)

---

## W1 — Schema pairing + boot bump (the lockstep commit)

*The deploy contract: this must land in the SAME deploy as the guru-side v4
export. Neither repo pushes first (guru's schema-drift CI hash-compares).*

- Copy guru's `schema/corpus-schema.sql` (v4 append included) byte-identical;
  regenerate the pairing hash: `sha256sum schema/corpus-schema.sql >
  schema/corpus-schema.sql.sha256`. CI (`ci.yml` sha256 check) passes only
  when both match.
- `boot.ts`: `EXPECTED_SCHEMA_VERSION = '4'` + changelog comment (v4:
  document-knowledge layer). Update any boot test pinning '3'.
- Done when: `npm run type-check` + tests green with the new schema file; CI
  hash check passes against the guru copy.

## W2 — App-side migration: session mode + study scope

New `migrations/014_study_mode.sql` (IF NOT EXISTS, normal migrate path):

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'chat'
    CHECK (mode IN ('chat','study'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS study_text_id TEXT;
```

- `mode='study'` requires `study_text_id` (enforced in the API layer, not the
  DB — the corpus lives in a different schema, no cross-schema FK).
- Sessions API (`/api/sessions`): accept `mode` + `study_text_id` on create;
  return them on read. Validation: `study_text_id` must exist in
  `corpus.texts` at create time.
- Done when: migration applies; sessions round-trip mode/study_text_id;
  invalid text id rejected with 400.

## W3 — Retrieval: the summary leg (study mode only)

`retriever.ts`:

- `retrieve(queryText, prefs, mode?, studyTextId?)` — compare/chat paths are
  **untouched** (design §5: tuned config stays as swept). Study mode adds a
  summary leg UNION'd into the vector candidates:

```sql
SELECT s.id,
       COALESCE(s.text_id, s.work_id)        AS text_id,
       s.tradition,
       COALESCE(tx.label, w.label)           AS text_name,
       COALESCE(s.section_span, 'Whole work') AS section,
       NULL::text                            AS translator,
       s.body, s.token_count,
       (s.embedding <=> $1::vector)          AS distance,
       'summary'                             AS source
FROM summary_nodes s
JOIN works w        ON w.id = s.work_id
LEFT JOIN texts tx  ON tx.id = s.text_id
WHERE <summaryScopeFilter>
ORDER BY s.embedding <=> $1::vector
LIMIT $k
```

- **`buildSummaryScopeFilter(prefs)`** (new, beside `buildScopeFilter`):
  tradition conditions verbatim; text conditions via
  `w.member_text_ids && $n::text[]` overlap (W0 finding #3). Unit test MUST
  include the NULL-text_id L2 fixture under both whitelist and blacklist.
- Study pinning: when `studyTextId` is set, both legs additionally scope to
  the pinned work's members (chunks: `text_id = ANY(members)`; summaries:
  `s.work_id = <work>`), resolved once via
  `SELECT work_id, member_text_ids FROM texts JOIN works … WHERE texts.id=$1`.
- `RetrievedChunk.source` union gains `'summary'`; rows get `tier: 'summary'`
  (W0 design decision). `applyQualityFilter` must pass summaries through
  untouched (they are generated, not scraped).
- Done when: retriever unit tests cover the UNION column compatibility, the
  membership scope fixture, and chat-mode non-regression (no summary leg).

## W4 — Prompt: dossier injection (study mode)

`prompt.ts`:

- New `buildStudyPrompt(queryText, chunks, dossier | null, prefs, tier,
  historyTokens)` — or a `dossier` param on `buildPrompt`. When a dossier row
  exists for the pinned work, prepend a `WORK DOSSIER:` block before
  `SOURCE PASSAGES:` containing `summary`, `context`, the structure TOC
  (span — title lines), `key_figures`/`key_terms` (compact), `themes` (labels
  resolved via `concepts`), `reading_notes`. Budgeted like history
  (`reservedExtra`), never compressed — the dossier is small by construction
  (§1.1 token bands).
- **Missing dossier → no block** (W0 finding #4); never an error, no
  placeholder text.
- Citation rules: dossier content is apparatus, not source — the system
  prompt block must say the model cites SOURCE PASSAGES, never the dossier.
- Done when: prompt snapshot tests for with-dossier, without-dossier, and
  dossier + zero-passages cases.

## W5 — API + UI

- `/api/query`: load the session's mode/study_text_id; study sessions call
  the W3 retrieve + W4 prompt; dossier fetched by the W0 Q1 query (one
  PK-shaped query, cacheable per session).
- UI: session-create surface gains a mode toggle + text picker (texts list
  already served for scope preferences); study sessions render the dossier
  TOC (structure_json) in the sidebar — display-only, from the same fetch.
- Citations: `citations.ts` must tolerate `source: 'summary'` rows (cite as
  "[work] — [span] (summary)"); summaries are expandable to primary chunks
  via `child_chunk_ids` if a "show sources" affordance is wanted later (the
  citation contract's escape hatch — not required for v1).
- Done when: an end-to-end study session against the pilot corpus returns a
  dossier block + mixed chunk/summary passages for `gnostic-john-baptizer-*`.

## W6 — Deploy sequence (design §4, unchanged)

1. Both repos ready: guru `feature/summary` (schema v4 + export) and guru-web
   Phase W branch (this doc's W1–W5). CI hash check binds them.
2. Load `guru-corpus.sql.gz` on hetzner — old build (expects '3') keeps
   serving until the swap.
3. Deploy the new guru-web build **in the same deploy step as the swap**
   (systemd restart) — either ordering error fails closed via the boot check.
4. `migrations/014` runs via the normal migrate path (app-side, independent
   of the corpus swap).

## Suggested ticket structure

guru-web HAS its own .todo store (correction to an earlier draft of this doc)
— and it holds b80d8d7d, the retrieval-pollution ticket the design doc cites:
now annotated as substantially resolved by the V8 source-side clean, closable
at the v4 deploy. Phase W tickets belong here: parent "Phase W: consume
document-knowledge layer in guru-web" with children
W1 (pairing+boot), W2 (migration+sessions API), W3 (summary leg + scope
filter), W4 (dossier prompt), W5 (query route + UI + citations). W6 is the
deploy runbook. W3 and W4 are parallel after W1; W5 needs both.
