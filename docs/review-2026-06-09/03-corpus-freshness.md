# 03 — Corpus freshness: reload on corpus_version, surface staleness

## Problem statement

The loaded corpus in staging Postgres is **corpus_version 30, exported
2026-05-29** — 11 days old at review time, missing 5 traditions, ~1,250
chunks, and ~10k verified EXPRESSES edges relative to the pipeline SQLite.
Nothing in the system flags this; it was discovered by psql spelunking.

Root cause (verified): `scripts/dev-setup.ts` decides whether to load the dump
by checking **only `schema_version`**:

```ts
// scripts/dev-setup.ts:9-10 (header), :72 (the check)
//   2. Corpus loaded? Check corpus.corpus_metadata.schema_version; if
//      missing or stale, pipe ../guru/export/guru-corpus.sql.gz through psql.
SELECT value FROM corpus.corpus_metadata WHERE key = 'schema_version'
```

`schema_version` only changes when the *shape* changes (it has been 3 since
2026-05-27). Content-only exports — the common case — bump `corpus_version`
(the pipeline's `export.py` auto-increments it), which dev-setup never reads.
So after the first successful load, staging freezes until someone manually
pipes a dump. Production presumably has the same failure mode via whatever
runs loads there.

## Design

### A. Reload condition: schema_version OR corpus_version changed

The dump is gzipped SQL, so the new version isn't queryable before load. The
pipeline review doc (`guru/docs/review-2026-06-09/01-export-sync-automation.md`)
proposes `export.py` emit a sidecar manifest:

```json
// ../guru/export/guru-corpus.manifest.json
{ "corpus_version": 31, "schema_version": 3, "exported_at": "...",
  "source_commit_sha": "...", "counts": { "chunks": 4378, "traditions": 21, ... } }
```

dev-setup then:

1. Reads the manifest (fall back to current behaviour if absent — old dumps).
2. Compares `(schema_version, corpus_version)` against `corpus.corpus_metadata`.
3. Loads on any mismatch. The dump's internal `corpus_new → corpus` atomic
   swap already makes the load safe to run over a live DB.
4. **Post-load verification**: compare `counts` from the manifest against
   `SELECT count(*)` per table; hard-fail the dev-setup step on mismatch.

The fast path stays fast: one extra `readFile` + one SELECT.

### B. Staleness visibility in admin

The admin dashboard should answer "what corpus is the product serving?"
without shell access. A small panel (or `/api/admin/corpus-status`) showing:

- `corpus_version`, `exported_at`, `source_commit_sha` from
  `corpus.corpus_metadata` (all already present — see the metadata table).
- Age in days, with a visual warning past a threshold (e.g. 7 days).
- Table counts (chunks/traditions/texts/concepts/edges) so a partial load is
  visible at a glance.
- If the manifest file is reachable in the deployment (it won't be on prod —
  the dump is transferred, not the pipeline repo): the available-vs-loaded
  version delta. On prod, skip this line rather than fake it.

This is read-only, tailnet-gated like the rest of admin, and ~1 query.

### C. Boot-time log line

`src/lib/boot.ts` already validates `schema_version` and embedding model. Add
one log line at boot: `[boot] corpus v30, exported 2026-05-29 (11d ago), 3128
chunks`. Staleness then appears in `journalctl -u guru-web` during any
incident triage, which is where the runbook already sends operators.

## Explicitly out of scope here

Automating the *production* export→transfer→load path end-to-end — that's the
pipeline-side sync script (`guru` doc 01) plus a deploy-side decision about
where dumps land on the VPS. This doc is about the web app detecting and
showing what it has.

## Acceptance criteria

- With a new dump at the same schema_version, `npm run dev` auto-loads it and
  the fast path still completes in ~hundreds of ms when nothing changed.
- A truncated/corrupt dump fails dev-setup loudly (ON_ERROR_STOP already does
  this; the count verification catches silent partials).
- Admin surface shows corpus_version + age; boot log line present.
- A stale-corpus situation like the current one (v30 loaded, v31+ available)
  is visible in two places (dev-setup output, admin) without psql.
