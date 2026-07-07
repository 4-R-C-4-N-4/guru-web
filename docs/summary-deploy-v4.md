# v4 Lockstep Deploy Runbook — document-knowledge layer

W6 of Phase W (todo:6c4e1312, parent 55aa9982). Companion: `docs/summary-phase-w.md`
(plan + W0 vetting), guru repo `docs/summary/implementation-guru.md` (corpus side).

## The contract

The corpus artifact and the app build are version-locked: `boot.ts`
`EXPECTED_SCHEMA_VERSION = '4'` refuses to serve against a v3 corpus, and the
old build (expects '3') refuses a v4 corpus. **Either ordering error fails
closed via the boot check** — a mispaired deploy is loud, never silently wrong.

Merging is NOT deploying. Both feature branches can merge to main days before
the deploy; nothing changes in prod until the swap step below.

## Preconditions

- [ ] guru-web PR #97 merged (this branch: W1–W6).
- [ ] guru PR #32 merged (its schema-drift check re-run green AFTER #97 merges —
      it compares `schema/corpus-schema.sql` against guru-web main).
- [ ] `guru-corpus.sql.gz` (v4, corpus_version ≥ 37, 52/52 dossier coverage)
      built from guru main: `python3 scripts/export.py`.
- [ ] Artifact smoke-tested locally: loads into pgvector with the inline
      validation NOTICEs passing (`dossier coverage: 52 of 52 works`).

## Deploy sequence (one maintenance window)

1. **Stage the corpus.** Copy `guru-corpus.sql.gz` to the host. The artifact
   is self-contained: it builds `corpus_new`, validates inline, then swaps
   `corpus_new` → `corpus` (old schema parked as `corpus_old`). Do NOT run it yet
   if step 2's build isn't ready to go in the same window.
2. **Build the new app** (`npm run build` on the merged main) so the swap and
   the process restart happen back-to-back.
3. **Swap + restart in one step:**
   ```sh
   gunzip -c guru-corpus.sql.gz | psql -1 -v ON_ERROR_STOP=1 "$DATABASE_URL" \
     && systemctl restart guru-web
   ```
   The `&&` is the lockstep: if the load fails, the old build keeps serving
   the old corpus untouched.
4. **App migration** runs via the normal migrate path (`migrations/014_study_mode.sql`
   is idempotent, app-side, independent of the corpus swap — it can run before
   or after; the study UI simply 400s on create until both are live).
5. **Boot check:** confirm startup logs show schema version 4 accepted. If the
   process crash-loops on a version mismatch, the pairing is wrong — restore
   by swapping `corpus_old` back or redeploying the old build; both are fast.

## Post-deploy verification

- [ ] Chat session end-to-end (non-regression: no summary leg, no dossier).
- [ ] Study session against a grouped work (e.g. any `gnostic-john-baptizer-*`
      text): dossier TOC strip renders; answers cite both `◆/○` chunks and `§`
      summary rows; refresh rehydrates the `§` citations.
- [ ] Scope regression: block an unrelated text in preferences, run a study
      query on a multi-member work — the L2 summary must still be retrievable
      (the W0 NULL-text_id bug's fix, `member_text_ids &&` overlap).

## Ticket close-out at deploy

- **b80d8d7d** (retrieval pollution): closable — the V8 source-side clean ships
  in this corpus; the runtime quality filter remains as defense-in-depth.
- **8673c77e** (golden-retrieval re-baseline): the corpus was re-embedded on
  cleaned chunks; re-run the golden set and commit the new baseline.

## Rollback

`corpus_old` is parked by the artifact's swap step: `ALTER SCHEMA` it back and
redeploy the previous build tag. Migration 014 needs no rollback (additive,
defaulted, CHECK-constrained; old code never reads the new columns).
