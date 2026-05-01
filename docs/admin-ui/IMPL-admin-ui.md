# Implementation Plan — Admin Observability Layer

Companion to `BRD-admin-ui.md` (data) and `BRD-admin-ui-design.md`
(design). The BRDs answer *what* and *why*; this doc answers *which
PRs, in what order, with what scope*.

Each section below corresponds to one ticket. Convert with `todo new`
once the parent feature ticket exists. The phasing matches Phase 0–2
in the data BRD §3 — read that first if you haven't.

**Hard rule:** ticket 1 (tailnet ingress) and ticket 2 (auth gate)
land before any data-rendering ticket. Everything else assumes that
floor exists. If you skip ahead and ship a `/admin/overview` page
without 1+2 in production, the page is internet-reachable.

---

## Parent ticket

```
feat: admin observability layer (read-only, tailnet-only)
type:  chore
tags:  admin, observability, security
file:  docs/admin-ui/BRD-admin-ui.md
```

Implements the Phase 0–2 plan from `BRD-admin-ui.md`. Spec-bound;
this ticket is the umbrella for the children below. Closes when
all children close.

---

## 1. Tailnet ingress (Caddy + cert renewal)

```
type:  chore
tags:  admin, security, caddy, tailscale, infra
file:  deploy/Caddyfile
```

**Scope.** The Caddy listener split (data BRD §0.1) and the
out-of-band Tailscale cert renewal (§0.3). All operator-side
infrastructure; no app code yet.

**Files (created or edited):**

- `deploy/Caddyfile` — add the second site block bound to the
  tailnet hostname. Public listener gains the `@admin` matcher
  rewriting to `/_admin-404`.
- `deploy/tailnet-cert-renew.sh` (new) — `set -euo pipefail`,
  runs `tailscale cert --cert-file ... --key-file ... <host>`,
  reloads Caddy on success only.
- `deploy/tailnet-cert-renew.service` (new) — oneshot systemd
  unit invoking the script.
- `deploy/tailnet-cert-renew.timer` (new) — daily, persistent.
- `deploy/README.md` — new "Tailnet admin listener" section with
  the install procedure (Caddyfile diff, validate, reload, cert
  bootstrap, timer install).
- `deploy/vps-bootstrap.sh` — **no changes.** Bootstrap is
  deliberately one-shot; admin install is a one-time hand patch
  documented in deploy/README.md.

**Done when:**

- `caddy validate --config /etc/caddy/Caddyfile` passes locally
  and on the VPS.
- `https://guru-ai.org/admin/` from the public internet returns
  a Next-style 404 page (response shape matches the app's
  generic 404, not a bare Caddy page).
- `https://guru-web-prod.<tailnet>.ts.net/` from a tailnet device
  reaches Next.js (which will 404 the empty admin routes until
  ticket 2 lands; that's expected at this phase).
- `systemctl list-timers` shows `tailnet-cert-renew.timer`
  active.
- Manual run of `/usr/local/bin/tailnet-cert-renew` regenerates
  the cert files and reloads Caddy with no errors in
  `journalctl -u caddy`.

**Tests:**

- Manual smoke (post-deploy, in runbook):
  ```
  curl -s -o /dev/null -w "%{http_code}\n" https://guru-ai.org/admin/
  # → 404
  ```
- `caddy validate` is the syntactic check; the smoke is the only
  meaningful end-to-end test.

**Operator action post-merge.** This is a manual deploy. The PR
ships the Caddyfile and scripts in the repo; the operator copies
them onto the VPS, validates, reloads Caddy, installs the timer.
Sequence belongs in the runbook section of `deploy/README.md`
that this ticket adds.

**Blocks:** all subsequent admin work — without this, the admin
surface is reachable from the public internet.

---

## 2. Auth gate (`requireAdmin`, middleware, empty admin route)

```
type:  chore
tags:  admin, security, auth, middleware
file:  src/lib/admin.ts
```

**Scope.** The in-process half of defense-in-depth: `requireAdmin()`
returning 404, middleware that 404s non-admins on `/admin/*` and
`/api/admin/*` before any handler runs, and an empty admin route
group so the matcher has something to match on. Closes data BRD
§1.1, §1.2, and the §1.13 admin-session ceiling.

**Files:**

- `src/lib/admin.ts` (new) — exports `requireAdmin()`,
  same shape as `requireUser()` but checks `process.env.ADMIN_USER_IDS`
  (comma-separated). Returns `User | Response` where the failure
  Response is `404`, never `401` / `403`.
- `src/middleware.ts` — gate `/admin/*` and `/api/admin/*`. For
  non-admins, return the same `/_admin-404` rewrite the public
  Caddy uses; admin sessions older than 1 hour (token `iat` claim)
  bounce to `/sign-in?redirect_url=...`.
- `src/app/(admin)/admin/page.tsx` (new) — single line: `<main>ADMIN</main>`.
  Exists so the route group resolves; gets replaced by the
  overview page in ticket 4.
- `src/app/(admin)/layout.tsx` (new) — minimal; `<AdminLayout>`
  fleshes out in ticket 4.
- `src/app/_admin-404/page.tsx` (new) — re-renders the standard
  Next 404 page so the response shape matches the app's normal
  404. Used by both the Caddy public listener (rewrite from §0.1)
  and the middleware (consistent shape across both gates).
- `.env.example` — document `ADMIN_USER_IDS=user_xxx,user_yyy`.
- `src/__tests__/admin.test.ts` (new) — see Tests below.

**Done when:**

- `requireAdmin()` returns 404 when:
  - request unauthenticated,
  - authenticated but `userId` not in `ADMIN_USER_IDS`,
  - `ADMIN_USER_IDS` env var unset.
- Middleware on `/admin/*` and `/api/admin/*` 404s non-admins
  before reaching any handler (verified by handler-side spy).
- A logged-in admin reaching `/admin` sees the placeholder; a
  logged-in non-admin sees a Next 404 indistinguishable from a
  bogus path.
- Admin session older than 1h forces re-auth; on return to
  `/admin`, the session resets.
- `npm run build` and `npx tsc --noEmit` clean.

**Tests** (data BRD §1.17):

```ts
// src/__tests__/admin.test.ts
describe('requireAdmin', () => {
  it('returns 404 Response when ADMIN_USER_IDS unset', ...);
  it('returns 404 Response when caller not in allowlist', ...);
  it('returns 404 Response when caller unauthenticated', ...);
  it('returns User record when caller in allowlist', ...);
});

describe('admin middleware', () => {
  it('rewrites non-admin /admin/* requests to /_admin-404', ...);
  it('lets admin /admin/* requests through', ...);
  it('forces re-auth when session iat > 1h old on admin path', ...);
  it('does not affect non-admin paths', ...);
});
```

Mock Clerk's auth state and `process.env.ADMIN_USER_IDS` per test.

**Operator action post-merge.** Set `ADMIN_USER_IDS` in
`/etc/guru-web.env` (this is a secrets file; admin user IDs are
not secrets but live there for unified env management).
Restart `guru-web`.

**Depends on:** ticket 1 (Caddy must already be rejecting public
admin paths; if you ship 2 first, the placeholder admin page is
publicly reachable for the window between merges).

---

## 3. Migration 008 — admin indexes

```
type:  chore
tags:  admin, migration, performance, postgres
file:  migrations/008_admin_indexes.sql
```

**Scope.** Data BRD §1.11 indexes: `idx_queries_user_created`,
`idx_queries_created`, `idx_sessions_updated`. All `CREATE INDEX
IF NOT EXISTS`.

**Files:**

- `migrations/008_admin_indexes.sql` (new).

**Done when:**

- Migration applies cleanly under `deploy.sh`'s
  `psql -1 -v ON_ERROR_STOP=1`.
- `EXPLAIN` on the user-list query (`MAX(created_at) GROUP BY user_id`)
  shows the index in use on a seeded prod-like DB.

**Tests:** none (DDL migrations use `IF NOT EXISTS` so re-running
is the test).

**Depends on:** nothing. Can ship anytime; placed mid-sequence
because the admin queries don't exist until ticket 4+.

---

## 4. Overview dashboard

```
type:  chore
tags:  admin, observability, ui
file:  src/app/(admin)/admin/page.tsx
```

**Scope.** Data BRD §1.5 stat tiles + tabular sparklines + top-10
tables. Design BRD §4.1 layout. Replaces the placeholder from
ticket 2.

**Files:**

- `src/app/(admin)/admin/page.tsx` — the overview UI.
- `src/app/(admin)/layout.tsx` — full `<AdminLayout>` (amber bar,
  left rail, content pane). Design BRD §3.1.
- `src/app/api/admin/overview/route.ts` (new) — JSON endpoint:
  stat-tile values + 30-day sparkline series + top-10 lists.
- `src/components/admin/StatTile.tsx` (new) — design BRD §3.2.
- `src/components/admin/TabularSparkline.tsx` (new) — design BRD §3.4.
- `src/lib/admin-queries.ts` (new) — the SQL helpers shared
  across admin endpoints (overview, users, sessions). Keeps the
  route handlers thin.
- `src/__tests__/admin-overview.test.ts` (new) — endpoint
  contract test (mock db, assert response shape).

**Done when:**

- `/admin` renders all stat tiles with real numbers, both
  tabular sparklines, both top-10 tables.
- MTD spend projection uses
  `(MTD spend / days_elapsed) × days_in_month` (data BRD §1.5).
- Both budget axes shown in §1.7's user-deep-dive style propagate
  here — when `usd_limit IS NULL` the "users at >80% of any
  budget axis" tile silently treats only the queries axis.
- `/api/admin/overview` returns 404 to non-admins.
- Page loads under 1s on the seeded fixture; under 2s on prod's
  current ~10-row dataset.

**Tests:**

- Endpoint test: mock db, assert JSON shape matches the page's
  expectations, `requireAdmin()` failure → 404.
- Smoke (manual): visit `/admin` from a tailnet device, eyeball
  every tile against a parallel `psql` session.

**Depends on:** tickets 1, 2.

---

## 5. Users list + deep dive

```
type:  chore
tags:  admin, users, observability, ui, csv
file:  src/app/(admin)/admin/users/page.tsx
```

**Scope.** Data BRD §1.6 (list) + §1.7 (deep dive). Design BRD §4.2,
§4.3. Includes the CSV export (§1.18) for the users list and the
per-user sessions list.

**Files:**

- `src/app/(admin)/admin/users/page.tsx` — users list.
- `src/app/(admin)/admin/users/[id]/page.tsx` — user deep dive.
- `src/app/api/admin/users/route.ts` — JSON list endpoint.
- `src/app/api/admin/users/[id]/route.ts` — single-user JSON.
- `src/app/api/admin/users.csv/route.ts` — CSV streaming
  endpoint, same filter params as the JSON list.
- `src/app/api/admin/users/[id]/sessions.csv/route.ts` — CSV
  for the user's sessions.
- `src/components/admin/DataTable.tsx` — design BRD §3.3.
- `src/components/admin/FilterPills.tsx` — design BRD §3.6.
- `src/components/admin/BudgetBar.tsx` — design BRD §3.5.
- `src/components/admin/csv.ts` — small streaming CSV writer
  helper (used by every `.csv` route).
- `src/__tests__/admin-users.test.ts`,
  `src/__tests__/admin-csv.test.ts`.

**Done when:**

- List view: filters (tier, created within, has queried, search)
  drive URL params; sort headers update URL; pagination at 50/page;
  Download CSV link in footer respects the same filter state.
- Deep dive: header strip with stat tiles + dual-axis budget bars;
  sessions list with row-click navigation; preferences snapshot;
  recent rate-limit hits.
- `<BudgetBar>` renders correctly when `usd_limit IS NULL`
  (shows `usd_used` only with a "no cap" tag).
- CSV export streams rather than buffers; verified by reading
  the response with a slow client (no full body materialised in
  Node memory).

**Tests:**

- Filter + sort URL state round-trips correctly (component test).
- Empty-state row when no users match filters.
- CSV endpoint streams headers + ≥1 row chunk separately
  (assert via `Response.body.getReader()` calls).
- All endpoints 404 to non-admins.

**Depends on:** tickets 1, 2, 4 (4 lands the admin layout this
ticket leans on).

---

## 6. Session + Query deep dives

```
type:  chore
tags:  admin, sessions, observability, ui, csv
file:  src/app/(admin)/admin/sessions/[id]/page.tsx
```

**Scope.** Data BRD §1.8, §1.9. Design BRD §4.4, §4.5. CSV export
for a session's queries (§1.18).

**Files:**

- `src/app/(admin)/admin/sessions/[id]/page.tsx`.
- `src/app/(admin)/admin/queries/[id]/page.tsx`.
- `src/app/api/admin/sessions/[id]/route.ts`.
- `src/app/api/admin/queries/[id]/route.ts`.
- `src/app/api/admin/sessions/[id]/queries.csv/route.ts`.
- `src/components/admin/ExpandableQuery.tsx` — design BRD §3.7,
  built on native `<details>`/`<summary>`.
- `src/__tests__/admin-sessions.test.ts`,
  `src/__tests__/admin-queries.test.ts`.

**Done when:**

- Session deep dive: header with breadcrumb (link to user, link
  to all sessions), stat tiles, list of `<ExpandableQuery>`
  collapsed by default. Expand-all / Collapse-all anchor links.
- Query deep dive: same payload as a single expanded
  `<ExpandableQuery>`, plus the raw-JSON `<details>` open by
  default.
- Expanded view shows the `model_pricing` row used (input rate,
  output rate, cached rate, `effective_from`) per data BRD §1.8.
  This is the diagnostic surface that distinguishes "this query
  cost more because we re-priced last week" from "this query
  cost more because the prompt was longer."
- Ctrl-F searches inside collapsed `<ExpandableQuery>` content
  (verifies the native `<details>` choice from design BRD §1.5).

**Tests:**

- Endpoint contract tests for both routes.
- Component test: `<ExpandableQuery>` collapsed text contains
  the truncated query (so Ctrl-F works); expanded contains full
  prompt + response.

**Depends on:** tickets 1, 2, 4, 5 (5 lands `<DataTable>`,
`<BudgetBar>`, the CSV helper).

---

## 7. Operational hygiene

```
type:  chore
tags:  admin, runbook, ops
file:  deploy/README.md
```

**Scope.** Data BRD §2 — runbook completion + Tailscale ACL audit
documentation. The infrastructure-side tickets (1, 2) added
runbook entries as they went; this ticket fills the gaps.

**Files:**

- `deploy/README.md` — finished admin-runbook section. Specifically:
  - "Add or remove an admin" full procedure.
  - "Reach the admin UI" with the Tailscale-down fallback.
  - "Tailscale ACL state" + how to audit it from the tailnet
    admin console.
  - Cross-references to the cert-renewal procedure from ticket 1.
  - Cross-references to the post-deploy smoke checks from data
    BRD §1.17.

**Done when:**

- A new operator (or future-you, six months later) can take the
  runbook cold and deploy a fresh admin onto the box without
  reading the BRDs.
- Every operator-action mentioned across tickets 1–6 has a
  corresponding runbook entry.

**Tests:** none (docs).

**Depends on:** tickets 1–6 (collects what they wrote).

---

## Out-of-band: deferred companion BRDs

Two follow-on docs to write *after* this feature ships, not part
of it. Listed here so they're visible in the same place.

- `BRD-admin-charts.md` — picks a chart library, enumerates
  charts, drill-downs. Replaces `<TabularSparkline>` per data BRD
  §1.16.
- `BRD-operator-mutations.md` — the psql snippets the admin UI
  deliberately doesn't expose (tier flips, quota resets,
  soft-delete *with read-side filtering*, kill-switch). Each
  snippet with checklist + reverse operation + example output.

---

## Cross-cutting commitments

These apply to every ticket; calling them out once here so they
don't get lost.

- **Access control test.** Every new endpoint (JSON or CSV) must
  have a `requireAdmin → 404` test. No exceptions.
- **URL state.** Every list view's filters / sort / pagination
  live in URL params, not local state. Design BRD §1.3.
- **No third-party UI library.** Native `<table>`, `<details>`,
  `<select>`, etc. Design BRD §1.5.
- **Tokens-only styling.** `tokens.ts` is the source of truth for
  colour and font. No new admin-specific tokens. Design BRD §6.1.
- **Mono font for IDs and JSON.** Design BRD §6.2.
- **Empty states are one-line.** Design BRD §5.3.
