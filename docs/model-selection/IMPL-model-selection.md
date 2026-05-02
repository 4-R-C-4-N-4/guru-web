# Implementation Plan — Model Selection + USD Budget Cap

Companion to `BRD-model-selection.md`. The BRD answers *what* and
*why*; this doc answers *which PRs, in what order, with what scope*.

Each section below corresponds to one ticket. Convert with `todo
new` once the parent feature ticket exists. Phasing matches BRD
§12 — read that first if you haven't.

**Hard rule:** ticket 1 (schema + tier limits) and ticket 2
(`CURATED_MODELS` map + resolver) land before ticket 3 (`/api/query`
integration). Skipping ahead means `/api/query` reads from a slug
that doesn't exist or budgets aren't enforced correctly.

**Hard rule 2:** ticket 4 (sync timer + CI guard) ideally lands
*with* ticket 1–3, because the throw-on-missing-pricing behaviour
(BRD §5.4) makes the first slug bump after launch a 500 if the
operator ever skips a manual sync. Phase 1 ships C1–C4 together for
this reason.

---

## Parent ticket

```
feat: model selection picker + USD budget cap
type:  feature
tags:  pricing, models, budget, ux
file:  docs/model-selection/BRD-model-selection.md
```

Implements BRD §12 phases 1–2. Phase 3 is a post-launch telemetry
review (ticket 7); phase 4 is reactive and lives outside this
parent. Closes when all children close.

---

## 1. Schema + tier limits + fallback refresh

```
type:  chore
tags:  pricing, schema, migration, budget
file:  migrations/009_user_model_pref.sql
```

**Scope.** All the data-layer changes the rest of the work depends
on. BRD §6.1, §6.2, §6.4.

- New nullable column `user_preferences.preferred_model TEXT`.
  Null means "use tier default."
- `TIER_LIMITS` in `src/lib/spend.ts` flips:
  - free stays `{ query_limit: 10,  usd_limit: null }`
  - pro becomes `{ query_limit: 100, usd_limit: 5.00 }` (was
    `{ query_limit: 30, usd_limit: null }`).
- `FALLBACK_PRICING` in `scripts/sync-pricing.ts` gains the four
  picker IDs (BRD §4.2 table) plus keeps `deepseek/deepseek-chat`
  for one release as a safety net.

**Files:**

- `migrations/009_user_model_pref.sql` (new) — single
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- `src/lib/spend.ts` — `TIER_LIMITS` const update only.
- `scripts/sync-pricing.ts` — `FALLBACK_PRICING` map update only.
- `src/__tests__/spend.test.ts` (extend) — assert dual-axis
  enforcement on pro: usd-cap binds at $5 even when queries-cap
  hasn't.

**Done when:**

- `deploy.sh`'s `psql -1 -v ON_ERROR_STOP=1` applies migration 009
  cleanly. Re-running is the test (`IF NOT EXISTS`).
- `npx tsc --noEmit` clean.
- `reserveBudget({ tier: 'pro', estimatedCostUsd: 5.01 })` returns
  `{ allowed: false, reason: 'usd' }` even with `queries_used = 0`.
- Existing pro-budget reservation tests still pass with the new
  caps applied.

**Tests:** unit-tests-in-vitest. No DB integration test —
migration is `IF NOT EXISTS` and verified manually post-deploy via
`\d user_preferences`.

**Operator action post-merge.** Migration auto-applies on next
deploy. No env or config change — the `TIER_LIMITS` rewrite kicks
in on the next `reserveBudget` UPSERT for each user, atomically.

**Blocks:** all subsequent model-selection work — without this,
ticket 2's resolver can't be wired into a route that reads from a
preference column that doesn't exist, and the cap won't actually
bind.

---

## 2. `CURATED_MODELS` map + slug resolver

```
type:  chore
tags:  models, pricing, slug-indirection
file:  src/lib/model.ts
```

**Scope.** The slug → OpenRouter ID indirection (BRD §5.1). Server-
side only; no UI yet. The map is the source of truth for which
model each provider slug points at.

**Files:**

- `src/lib/model.ts` — add `CURATED_MODELS` const + `CuratedSlug`
  type + `resolveCuratedModel(slug)` helper. Existing `MODELS`
  const stays for backwards compatibility during phase 1 but is
  not referenced by the new code.
- `src/__tests__/model.test.ts` (new) — slug resolver returns
  expected ID for each curated entry; unknown slug throws;
  exhaustiveness over the type.

**Done when:**

- `CURATED_MODELS` keys are exactly `deepseek`, `xai`, `anthropic`,
  `openai` (BRD §4.2).
- `resolveCuratedModel('anthropic')` returns
  `'anthropic/claude-sonnet-4.6'`.
- TypeScript treats unknown-slug calls as compile errors.
- `npx vitest run src/__tests__/model.test.ts` clean.

**Tests:** unit only. The map is a small constant — exhaustive
slug coverage in the test file.

**Operator action post-merge.** None.

**Depends on:** nothing. Can land before or after ticket 1.

---

## 3. `/api/query` slug resolution

```
type:  chore
tags:  api, models, pricing, integration
file:  src/app/api/query/route.ts
```

**Scope.** Wire ticket 2's resolver into the live query path. BRD
§7.2.

**Files:**

- `src/app/api/query/route.ts` — replace `MODELS[user.tier]` with
  slug-aware logic: load `user_preferences.preferred_model`,
  default to `'deepseek'` if null or if tier is free, resolve to
  ID via `resolveCuratedModel`, pass into `complete()` /
  `completeStream()`.
- `src/lib/prefs.ts` — extend `loadPrefs` to include
  `preferred_model` in the SELECT list and the returned shape
  (nullable, slug type or null).
- `src/lib/types.ts` — extend `UserPreferences` type with the new
  field.
- `src/__tests__/api.test.ts` (extend) — pro user with
  `preferred_model = 'anthropic'` causes `/api/query` to call
  OpenRouter with `anthropic/claude-sonnet-4.6`; pro user with
  `preferred_model = null` falls through to `deepseek/deepseek-v4-pro`;
  free user with any preference value still resolves to default
  (free can't pick).

**Done when:**

- A pro user with no preference saved gets DeepSeek V4 Pro on
  every query.
- A pro user with `preferred_model = 'anthropic'` saved gets
  Sonnet 4.6 on every query, with the resolved ID stored in
  `queries.model_used`.
- A free user gets DeepSeek V4 Pro regardless of any value in
  `preferred_model` (the field is ignored for free).
- Cost estimate before `reserveBudget` uses the resolved ID's
  pricing (verified by checking `cost_usd` in `queries`).
- `npx tsc --noEmit` clean; full test suite pass.

**Tests:**

- Unit: route handler with mocked `auth`, `loadPrefs`,
  `complete`, `reserveBudget`, `finalizeBudget` — assert
  `complete()` called with the resolved ID.
- Smoke (manual, post-deploy): make a query as a pro user, then
  flip the preference to `anthropic` via SQL on the VPS, make
  another query, verify `queries.model_used` shows the new ID.

**Operator action post-merge.** None — the default switch from
Sonnet 4.5 to DeepSeek V4 Pro happens on the next pro user query
silently. Existing pro users see a model change without any
preference write. Phase 2's banner (ticket 5) is what announces
this to them.

**Depends on:** tickets 1, 2.

---

## 4. Sync timer + CI guard + runbook

```
type:  chore
tags:  pricing, ops, ci, runbook
file:  deploy/sync-pricing.timer
```

**Scope.** The three-layer pricing-sync safety net from BRD §8 —
drift catcher, CI guard, runbook. Without this, the first slug
bump after launch can take down `/api/query` (BRD §5.4).

**Files:**

- `deploy/sync-pricing.service` (new) — oneshot, `User=guru`,
  `EnvironmentFile=/etc/guru-web.env`, `ExecStart=/usr/bin/npx tsx
  /srv/guru-web/current/scripts/sync-pricing.ts`.
- `deploy/sync-pricing.timer` (new) — `OnCalendar=daily`,
  `RandomizedDelaySec=15m`, `Persistent=true`.
- `deploy/README.md` — new "Pricing sync" section: install
  procedure, validation (`systemctl list-timers`), recovery (manual
  `npm run sync-pricing`), what failure looks like
  (`journalctl -u sync-pricing`).
- `src/__tests__/curated-models.integration.test.ts` (new) — for
  each entry in `CURATED_MODELS`, assert
  `getPricing(modelId, new Date())` returns a non-null row.
- CI workflow change — ensure the test DB has a fresh
  `npm run sync-pricing` run before the integration test runs.
  May need a small CI-only flag/fixture.

**Done when:**

- Timer installs cleanly on the VPS (mirrors `tailnet-cert-renew`
  install — same install commands work).
- `systemctl list-timers sync-pricing.timer` shows it active.
- A scheduled run produces `[sync-pricing] done: seeded=N
  updated=M unchanged=K` in `journalctl -u sync-pricing`.
- CI fails when a `CURATED_MODELS` value is added/changed without
  a corresponding pricing row.
- `deploy/README.md` "Pricing sync" section is complete enough
  that a fresh operator can install the timer cold from the
  runbook without reading this doc or the BRD.

**Tests:** the CI integration test IS the test. No unit-test
surface — the systemd units are validated via
`systemd-analyze verify` locally and via `systemctl status` on
the VPS.

**Operator action post-merge.** One-time hand-patch on the VPS
mirroring the tailnet-cert-renew install:

```bash
ssh root@guru-web-prod
SHA=$(ls -1t /srv/guru-web/releases | head -1)
install -m 0644 /srv/guru-web/releases/$SHA/deploy/sync-pricing.service \
                /etc/systemd/system/sync-pricing.service
install -m 0644 /srv/guru-web/releases/$SHA/deploy/sync-pricing.timer \
                /etc/systemd/system/sync-pricing.timer
systemctl daemon-reload
systemctl enable --now sync-pricing.timer
systemctl list-timers sync-pricing.timer    # confirm active
```

**Depends on:** tickets 1, 2 (CI guard tests both schema + map).
Can land in parallel with ticket 3 — they don't share files.

---

## 5. Settings picker UI

```
type:  chore
tags:  ui, settings, models, pro
file:  src/app/(app)/settings/page.tsx
```

**Scope.** The pro-only model picker (BRD §7.3). Native HTML, four
radio options. Each row reads `<provider> — <resolved id>` so the
user always sees the actual model.

**Files:**

- `src/app/(app)/settings/page.tsx` — new "Model" section
  rendering the four `CURATED_MODELS` entries. Resolved ID
  rendered from the const at render time so version bumps
  auto-update the label.
- `src/app/api/preferences/route.ts` (extend) — accept
  `preferred_model` in the PATCH body, validate against
  `CURATED_MODELS` keys, reject other values with 400. Free users
  may save (it's ignored at query time per ticket 3).
- `src/__tests__/preferences.test.ts` (extend or new) — round-trip
  preference write/read; invalid slug rejected.
- Existing `<NavBar>` / settings-page tests should still pass.

**Done when:**

- Pro user's settings page shows the four picker options, current
  selection highlighted (default DeepSeek if unset).
- Selecting a different option PATCHes the preference; reload
  shows it persisted.
- Free user sees the section in a disabled state with a "Pro only"
  tag and an upgrade link.
- Invalid slug values rejected at the API layer with 400.
- `npm run build` and `npm run lint` clean.

**Tests:**

- Unit/component: round-trip with mocked fetch.
- Smoke (manual): pick each of the four, verify chat responses
  attribute correctly (relies on ticket 6).

**Operator action post-merge.** None.

**Depends on:** tickets 2, 3 (picker writes a preference; route
must already be reading it).

---

## 6. Chat response attribution line

```
type:  chore
tags:  ui, chat, models, attribution
file:  src/components/chat-view.tsx
```

**Scope.** Per-response attribution line (BRD §7.4). One small
mono-font line below each AI response showing model + tokens +
cost. Sourced from `queries.model_used`, `queries.{input,output}_tokens`,
`queries.cost_usd` — all already populated.

**Files:**

- `src/components/chat-view.tsx` — append a `<div>` after each
  AI message rendering the three values. ~15 lines. `tokens.text.muted`
  colour, smaller than body, no border or background.
- `src/lib/types.ts` — extend the message type if cost/tokens
  aren't already in it.
- `src/app/api/sessions/[id]/route.ts` — verify the GET response
  includes the cost/tokens columns (extend SELECT if not).
- `src/__tests__/chat-view.test.ts` (extend) — assert the
  attribution line renders with the resolved model id and
  formatted cost.

**Done when:**

- Every AI response in the chat view shows
  `<resolved-model-id> · <Nk tokens> · $<cost>` below the body.
- The model id matches `queries.model_used` for that query.
- Streaming responses get the line populated after the
  finalizeBudget step writes the row (currently the chat view
  re-fetches; verify this still surfaces the line correctly on
  the first render after streaming completes).
- `npm run lint` clean.

**Tests:**

- Component: render with a fixture message, assert text content.
- Smoke: ask a query, verify line appears on response with the
  expected model id; switch picker, ask again, verify the new
  responses show the new id while old responses still show the
  old id (per-response attribution, not session-level).

**Operator action post-merge.** None.

**Depends on:** ticket 3 (route must store resolved id correctly).

---

## 7. In-app default-switch banner

```
type:  chore
tags:  ui, ux, banner, communication
file:  src/components/chat-view.tsx
```

**Scope.** One-time dismissible banner on `/chat` for existing pro
users explaining the default-model change. BRD §9 step 4. Without
it, the silent switch from Sonnet to DeepSeek surprises users.

**Files:**

- `src/components/chat-view.tsx` — small banner component at
  the top of the chat pane. Dismissed state in localStorage with a
  versioned key (`admin.banner.modelpicker.v1`) so we can show new
  banners later without un-dismissing this one.
- Banner copy:
  > Pro now lets you pick your AI model. Default switched to
  > DeepSeek for cost reasons — change it in
  > [Settings](/settings) if you'd rather use Anthropic, OpenAI,
  > or X.AI.
- `src/__tests__/chat-view.test.ts` (extend) — banner shows when
  localStorage key absent; hidden after dismiss; persists across
  reloads.

**Done when:**

- Pro user's first visit to `/chat` after deploy shows the banner.
- Dismiss button removes the banner and writes to localStorage.
- Reload doesn't re-show it.
- Free users never see the banner (pro-only check in the render).
- New signups (post-launch) don't see the banner — they never
  experienced the old default, so the announcement doesn't apply.
  Either gate on `users.created_at < banner_release_date` or
  accept the small UX cost of showing it briefly to new signups
  in the first hour after deploy. Opt for the latter; it's
  shorter code and a smaller-footgun.

**Tests:** component-level, mocked localStorage.

**Operator action post-merge.** None.

**Depends on:** ticket 5 (banner links to `/settings`; settings
section must exist).

---

## 8. Telemetry review (post-launch chore)

```
type:  chore
tags:  telemetry, review, post-launch
file:  docs/model-selection/POST-LAUNCH-NOTES.md (new)
```

**Scope.** BRD §12 phase 3. After one week in production, read
the data and decide whether the curated list, the cap, or both
need adjustment.

This is an operator-action ticket with no code change. Closing it
produces a short notes file (or comment in the BRD) capturing
what we learned.

**Done when:**

A short note (committed or in the ticket) covering:

- Distribution of `preferred_model` across pro users (admin UI
  users list filtering or a one-shot SQL).
- Distribution of `cost_usd` per pro user against the $5 cap —
  histogram of monthly spend.
- Number of users hitting `usd_limit` before `query_limit` (the
  "cap is the binding constraint" cohort).
- Number of users hitting `query_limit` first (signals cap is too
  loose for what they're actually using).
- sync-pricing timer journal — number of price-change events
  caught vs no-op runs.
- Recommendations: keep / bump cap / change curated list / change
  default. Each backed by one of the data points above.

**Tests:** none (review).

**Depends on:** tickets 1–7 in production for ≥7 days.

---

## Cross-cutting commitments

These apply to every ticket; calling them out once here so they
don't get lost.

- **Sync-then-PR.** Any change to `CURATED_MODELS` ships with a
  paired `npm run sync-pricing` run + commit/PR. CI guard from
  ticket 4 enforces this.
- **Resolved IDs in storage, slugs in preferences.** Never store
  a slug in `queries.*`. Never store a resolved ID in
  `user_preferences.preferred_model`. The split is what makes
  silent version bumps work.
- **Pricing test parity.** Every new test fixture that mocks a
  `queries` row must include `cost_usd` and `model_used`
  populated; otherwise the chat attribution + admin UI
  assertions don't match real production rows.
- **No third-party UI library.** Native HTML for the picker, the
  banner, the attribution line. Same constraint as the admin UI
  (BRD-admin-ui-design §1.5).
- **Tokens-only styling.** `tokens.ts` is the source of truth for
  colour and font in the new components.

---

## Out-of-band / deferred

Two follow-on docs / tickets to write *after* this feature ships,
not part of it. Listed here so they're visible:

- **Per-query model override** — a "use Sonnet for this one" button
  on the chat composer. Defer until phase 3 telemetry shows demand
  (BRD §10).
- **Higher pro tier** — opens the door to Opus 4.6 / GPT-5.5 on
  the picker. Cap math worked out in BRD §3.2 + §4.2 ("Add Opus
  only if cap is bumped to $8+ later"). Separate BRD when ready.
- **Lazy-sync from `/api/query`** — only revisit if telemetry
  shows missing-row throws happening despite the CI guard
  (BRD §8.4).
