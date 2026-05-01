# BRD — Admin Observability Layer

Source: ad-hoc need for operator visibility into prod usage. Single
operator, single VPS, post-launch.

Target repo: `guru-web`. To be added under `/admin/*` route prefix and
backed by `/api/admin/*` route handlers, served only over the tailnet
hostname `guru-web-prod.tailb5626e.ts.net`.

The current scaffold has zero admin surface — no operator can see who is
querying, which queries fail, which sessions burn the most tokens, or what
share of traffic is free vs pro. Stripe has its dashboard; OpenRouter has
its dashboard; Postgres has nothing in front of it. This BRD specifies a
**read-only observability layer**, gated behind a tailnet-only ingress and
operator-only auth.

Mutations are explicitly out of scope. The rare cases where prod data
genuinely needs to change (tier overrides, quota resets, content removal)
are better handled in `psql` — the manual friction is a feature, the shell
history is the audit log, and a clickable mutation surface invites
mistakes. If a future need ever justifies a specific scoped mutation, that
is a separate BRD.

Phases are merge-ordered: 0 → 1 → 2.

---

## Phase 0 — Tailnet-only ingress

The most consequential decision in this BRD. `/admin/*` and `/api/admin/*`
are reachable **only** via the VPS's Tailscale hostname,
`guru-web-prod.tailb5626e.ts.net`. The public Cloudflare-fronted hostname
returns 404 for those paths.

This is qualitatively stronger than an IP allowlist: a stolen Clerk
session, a leaked admin user ID, or a credential-stuffing bot cannot reach
the admin surface from the public internet at all, because no resolver
outside the tailnet returns an address for it.

### 0.1 Caddy split — public vs tailnet

`deploy/Caddyfile` gains a second site block bound to the tailnet
hostname. Same Next.js process on `localhost:3000`, two ingress paths
with different routing rules:

```
# Public — user-facing. /admin/* explicitly rejected.
{$DOMAIN} {
    tls /etc/ssl/cloudflare/origin.pem /etc/ssl/cloudflare/origin.key {
        client_auth {
            mode require_and_verify
            trust_pool file /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem
        }
    }

    @admin path /admin /admin/* /api/admin /api/admin/*
    respond @admin 404

    encode gzip zstd
    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}

# Tailnet-only — admin surface. Cert provisioned out-of-band by
# `tailscale cert` (see below); read from disk like any other TLS pair.
guru-web-prod.tailb5626e.ts.net {
    tls /etc/ssl/tailnet/guru-web-prod.tailb5626e.ts.net.crt \
        /etc/ssl/tailnet/guru-web-prod.tailb5626e.ts.net.key

    reverse_proxy localhost:3000

    header {
        X-Robots-Tag "noindex, nofollow"
        Referrer-Policy "no-referrer"
    }
}
```

**Cert provisioning is deliberately out-of-band.** Caddy reads files;
a separate small script run on a systemd timer keeps those files
fresh. Concretely:

- `/etc/ssl/tailnet/` (mode 0750, owned `root:caddy`).
- `tailscale cert --cert-file /etc/ssl/tailnet/<host>.crt --key-file /etc/ssl/tailnet/<host>.key <host>`
  on a daily timer; reload Caddy on success.
- Failure mode is "stale cert on disk if the timer's been failing for
  weeks unnoticed" — much narrower than "Caddy can't get a cert at
  request time because tailscaled is restarting." The timer's status
  shows up in `systemctl list-timers` and journal noise on failure.

This is preferred over the in-process `get_certificate tailscale`
directive because:

- That directive depends on the `caddy-tailscale` plugin, which is
  not in the stock Debian/Cloudsmith Caddy build. Pulling it in
  means a custom build (`xcaddy`) and a maintained third-party
  module — extra moving parts for a one-listener feature.
- Requiring `tailscaled` to be up at TLS-handshake time couples a
  request-path dependency to a daemon that occasionally restarts.
  File-based decouples them entirely.

**Caddyfile changes are applied manually**, not automated. The
operator edits `/etc/caddy/Caddyfile` on the VPS, runs
`caddy validate --config /etc/caddy/Caddyfile`, then
`systemctl reload caddy`. Automating Caddyfile rewrites in
`deploy.sh` widens the deploy user's blast radius — every commit
gains the ability to alter the network ingress shape, which is the
opposite of what we want for a config that should change rarely and
under deliberate review. The runbook (§2.2) carries the exact
sequence.

The public listener already enforces Cloudflare authenticated origin
pulls (mTLS to the `authenticated_origin_pull_ca`). Combined with the
tailnet listener binding only to the Tailscale hostname, there is no
public-internet path that reaches `/admin/*` — the public listener
rejects it at L7, and direct-to-VPS public TLS handshakes are rejected
at the cert layer for lacking a Cloudflare client cert.

### 0.2 Why both listeners on the same Next.js process

The temptation is to run two Next.js processes — one for public, one for
admin — to defend against a routing bug. Rejected:

- A second process means a second build, a second systemd unit, a second
  port, and double the memory footprint on the CX22.
- The Caddy `respond @admin 404` rule already prevents the public path
  from reaching Next.js for admin routes. A bug in that rule is the only
  failure mode that would matter, and the middleware (§1.2) and handler
  (§1.1) checks are designed to catch exactly that case.
- Single process keeps the dev environment realistic — `npm run dev`
  serves both surfaces just like prod does, distinguished only by host
  header.

### 0.3 Operational risk — Tailscale cert renewal

With the file-based approach (§0.1), the failure mode is "the renewal
timer has been silently failing for long enough that the on-disk cert
has expired." Tailscale-issued certs are 90 days. Plenty of headroom,
but the warning signals must be visible, not buried.

Mitigations:

- Daily `systemd` timer running the renewal script. Existing pattern
  on this host (cron.daily for `guru-backup`, etc.).
- Renewal script `set -e` on every command and reloads Caddy only
  on success. A failure leaves the previous cert in place — the UI
  keeps working until the existing cert expires.
- `journalctl -u guru-tailscale-cert.service` and `systemctl
  list-timers` are the diagnostic surfaces. Add to the runbook
  (§2.2) as the place to look first when admin UI returns a TLS
  error.
- Recovery is one command: `sudo /usr/local/bin/tailscale-cert-renew`
  (the same script the timer fires) regenerates the cert and
  reloads Caddy. Documented in the runbook.

Out of scope for this BRD: building a separate alerting path for
expired-cert detection. The 90-day window plus a daily timer plus
operator habit of opening the admin UI weekly is sufficient — if a
month of failed renewals goes unnoticed, that's a different problem.

### 0.4 Devices on the tailnet

The admin UI is reachable from any device on the operator's tailnet —
in practice, the home desktop and the phone. Browsers on iOS / Android
resolve `*.ts.net` hostnames natively when the Tailscale app is
connected. The phone is the practical "always with me" device for
checking prod state away from the desk.

### 0.5 No fallback for tailnet-unavailable scenarios

If Tailscale is down or the operator is on a device that cannot join the
tailnet, there is no admin UI access. This is correct. The fallback path
for any actual emergency (a kill-switch-style intervention) is `ssh` to
the VPS and a direct `psql` session — exactly the same path used for any
mutation outside this UI.

No env flag, no "open admin to public for 1 hour" toggle.

---

## Phase 1 — Read-only observability

The minimum that lets the operator answer "what's happening on prod right
now" without `psql`.

### 1.1 Operator identity via env-var allowlist

Admin identity is **not** a column on `users` and **not** a Clerk
publicMetadata field. It is an env var.

- Add `ADMIN_USER_IDS` to `/etc/guru-web.env` — comma-separated list of
  Clerk user IDs (`user_2abc,user_2def`).
- Add `src/lib/admin.ts` with `requireAdmin()` — same shape as
  `requireUser()`, returns `User | Response`. Returns 404 (not 403) when
  the caller is not in the allowlist; the route should be indistinguishable
  from a non-existent path even on the tailnet hostname.
- The same comment that motivates reading `tier` from Postgres rather than
  Clerk's publicMetadata applies here: the identity provider is third-party,
  the source of truth for high-privilege flags should not be flippable from
  the Clerk dashboard.

Trade-off accepted: rotating an admin requires a deploy. For a single
operator this is correct — the deploy is a forcing function for the audit
question "do I actually want a second admin".

### 1.2 Middleware-level rejection

In `middleware.ts`, before Clerk runs `auth.protect()` for `/admin/*` and
`/api/admin/*` routes, verify the authenticated user ID is in the
`ADMIN_USER_IDS` allowlist. Non-admins receive a 404 from middleware —
the request never reaches the route handler.

This is defense in depth against a routing bug or a forgotten check in a
new handler. The Caddy split (§0.1) is the primary network control; the
middleware check is the primary application control; the handler-level
`requireAdmin()` is the last-ditch check. All three exist because each
defends a different failure mode.

### 1.3 Route surface — pages

Under `src/app/(admin)/admin/*` (route group, separate from `(app)`):

- `/admin` — Overview. Single landing dashboard.
- `/admin/users` — Users list with filters.
- `/admin/users/[id]` — Per-user deep dive.
- `/admin/sessions/[id]` — Session deep dive (all queries, all timing).
- `/admin/queries/[id]` — Single query deep dive (full prompt, full
  response, retrieved chunks, model, tokens, latency).

The `(admin)` route group has its own layout with a distinct visual
treatment — see 1.10. It does not share `NavBar` with `(app)`.

### 1.4 Route surface — APIs

Under `src/app/api/admin/*`:

- `GET /api/admin/overview` — counts and time series for the dashboard.
- `GET /api/admin/users` — paginated, filterable users list.
- `GET /api/admin/users/[id]` — single user with full context.
- `GET /api/admin/sessions/[id]` — session metadata + ordered queries.
- `GET /api/admin/queries/[id]` — single query, full payload.
- `GET /api/admin/usage` — query/token time series with grouping.

All return JSON. All require admin via `requireAdmin()`. All are GET-only.

### 1.5 Overview dashboard contents

Spend is the source-of-truth signal, not tokens. Cost is computed at
write time and stored in `queries.cost_usd` (migration 006), priced via
the time-versioned `model_pricing` table. All spend figures in this UI
are `SUM(cost_usd)` over the relevant window — never recomputed from
token counts and current rates, which would mis-cost historical periods
across price changes.

Stat tiles (top row, current values):

- Total users (all-time, 30d new, 7d active).
- Pro / free split (count + % of active).
- Queries today / this week / this month.
- Spend today / this week / this month, separated by tier.
- MTD spend with month projection (linear extrapolation from current
  run rate). The projection is the early-warning signal — tells you on
  day 12 that the month is on track to be 1.4× last month, well before
  the bill.
- Active rate-limit holds (count of rows in `rate_limits` with
  `last_at > now() - 5min`).
- Users at >80% of any budget axis (`queries_used / query_limit` or
  `usd_used / usd_limit` from `user_budgets`). Click → filtered users
  list.

The two budget axes from `user_budgets` are first-class: a tile that
treats only the query axis is incomplete now that the schema supports
USD caps, even if pro currently has `usd_limit = NULL`.

Time series (presented as compact tabular sparklines in v1; see §1.16
for the chart-rich v2 deferred to a follow-on BRD):

- Queries per day, last 30 days, stacked by tier.
- Spend per day, last 30 days, stacked by tier.
- Top 10 users by spend this week (table, with trend arrow vs prior
  week, links to user deep dive).
- Top 10 sessions by spend this week (table, links to session deep
  dive).

No live updates. Polling on page load is sufficient. The operator either
opens the page or doesn't; this is not a wallboard.

### 1.6 Users list contents

Table columns:

- Email (truncated, full on hover).
- Tier badge (free / pro, colored — `tokens.tier.verified` for pro).
- Created at.
- Last query at (computed, indexed lookup).
- Queries (7d).
- Spend (7d) — `SUM(cost_usd)` over the user's queries in the last
  7 days. Tokens are deferred to the deep-dive view; spend is the
  more directly useful number at list scope.
- Stripe customer ID (link icon → opens Stripe dashboard search in new tab,
  not embedded — Stripe owns billing).

Filters:

- Tier (free, pro, all).
- Created within (today / 7d / 30d / all).
- Has queried (today / 7d / 30d / never).
- Free-text search on email (server-side `ILIKE`, indexed).

Sorts: created_at, last_query_at, queries_7d, spend_7d. Pagination 50/page.

### 1.7 User deep dive contents

Header:

- Email, Clerk user ID (copyable).
- Tier badge, Stripe customer link.
- Account age, queries lifetime, spend lifetime, tokens lifetime.
- Today's budget — both axes from `user_budgets` (daily period):
  `queries_used / query_limit` with bar, and `usd_used / usd_limit`
  with bar. When a limit is `NULL` (axis unenforced), show `used` only,
  no bar, with a muted "no cap" tag. Currently free=10/null and
  pro=30/null; this UI must render the USD axis correctly the day
  pro flips to a USD cap.

Body:

- Sessions list (newest first), each row showing title, query count,
  last activity, total spend. Click → session deep dive.
- Preferences snapshot (`scope_mode`, blocked/whitelisted lists from
  `user_preferences`).
- Recent rate-limit hits (last 24h from `rate_limits`).

### 1.8 Session deep dive contents

Header: session title (or "Untitled"), user email (link to user deep dive),
created/updated timestamps, query count, total spend, total tokens.

Body: every query in the session in chronological order, expandable.
Collapsed view shows query text (first ~80 chars), model, cost, tokens,
time. Expanded view shows the full prompt, full response, list of
`chunks_used` (rendered as `tradition / text / section` triples),
tier_used, model, input/output/cached tokens, cost_usd, the
`model_pricing` row that produced the cost (input rate, output rate,
cached rate, effective_from).

Both prompt and response are shown verbatim. This is the operator's only
view of what the user actually sent and what the model actually returned.
Truncation belongs in the collapsed-row UI, never in the expanded payload.

### 1.9 Query deep dive contents

Same as the expanded query in 1.8, plus a "raw JSON" toggle that dumps the
DB row exactly. This is the surface that lets the operator answer "did the
prompt builder do the right thing for this user, with their preferences,
on this query."

### 1.10 Visual treatment

- Same `tokens.ts` palette — `bg.deep` background, `text.primary`,
  `border.subtle`. The admin UI is part of the same product visually.
- A persistent thin amber bar (`tokens.text.accent`, 2px) along the top of
  every admin page, stating `ADMIN — observability`. Removes any ambiguity
  about which mode the operator is in.
- Mono font (`tokens.font.mono`) for any user IDs, session IDs, query IDs,
  and JSON dumps.
- Layout uses tables with explicit columns, not card grids. Density is
  the goal.

### 1.11 Performance / indexing

The user-list query needs `last_query_at` per user. Naive `MAX(created_at)
GROUP BY user_id` over `queries` is fine at small scale but degrades.
Spend aggregations for the overview tiles and the per-user spend column
add the same shape of work. Add migration:

```
008_admin_indexes.sql:
  CREATE INDEX IF NOT EXISTS idx_queries_user_created ON queries(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_queries_created       ON queries(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated      ON sessions(updated_at DESC);
```

(006 and 007 are already taken by the cost/budget and model-id
normalisation migrations.) `cost_usd` does not need a dedicated index;
the time-bucketed aggregations covered by `idx_queries_created` and
`idx_queries_user_created` also serve the spend rollups since they're
range-scanned by created_at.

Token and cost aggregations over `queries` for the time-series displays
should be served by a single query per series, not N+1. Acceptable at
current scale (<10k queries) without materialization.

### 1.12 PII posture

Admin views render full email addresses, full prompt text, and full
response text. This is intentional for a single-operator observability
tool: stripping PII from your own observability is a bigger lie than
admitting that the operator can read prod data. The privacy policy
should reflect that the operator can view query content for diagnostic
purposes; if it doesn't, that's a separate fix outside this BRD.

The implication is that admin sessions are sensitive even though they
are read-only — see §1.13.

### 1.13 Admin session lifetime

Clerk session timeout for admin routes is shortened relative to user
sessions. Implementation: re-prompt for sign-in if the Clerk session is
older than 1 hour when accessing `/admin/*`. (Clerk supports this via
session token expiry checks at middleware level.)

Reduced urgency given Phase 0 — a stale session cookie can only be used
by a device on the tailnet — but the PII posture in §1.12 makes this
worth keeping.

### 1.14 No client-side analytics

The admin UI loads no third-party scripts. No Sentry, no PostHog, no
fonts from Google. (The main app already loads `Cormorant Garamond`
externally — admin pages don't, since the admin UI uses sans/mono only,
not display.) Reduces the surface area for any third party to learn the
shape of the admin UI or capture data shown on it.

### 1.15 Out of scope

- Any mutation. No tier flips, no budget resets, no session/query
  deletion, no user impersonation. The CLI is the right tool for those.
- Real-time updates / websockets / SSE.
- Export to CSV.
- Multi-admin tracking.

### 1.16 Charts — deferred to follow-on BRD

This BRD ships data visibility, not visual richness. Time-series
displays in §1.5 are tabular sparklines (a fixed-width row with
date, count, bar rendered in CSS) — enough to spot a spike, not enough
to dwell on shape. Anything richer — proper line charts, stacked
areas, distribution plots, hour-of-day heatmaps, drill-downs from
chart click — is out of scope and belongs in a follow-on BRD
(`BRD-admin-charts.md`).

The charts BRD will pick a chart library (Recharts is the leading
candidate), enumerate the chart inventory question-by-question, and
specify drill-down behaviour. None of that work blocks the data
visibility this BRD delivers.

---

## Phase 2 — Operational hygiene

Small things that sit alongside the admin UI.

### 2.1 Tailscale ACLs

Tailscale ACLs are managed at the tailnet level, not in this repo, but
the BRD calls out the implication: only the operator's own devices need
to reach the VPS on port 443 (admin) and port 22 (ssh). If a future
collaborator joins the tailnet, an ACL rule should restrict them away
from `guru-web-prod` entirely.

Document the current ACL state in the runbook. Re-verify whenever a
device or user is added.

### 2.2 Operator runbook

A `docs/admin-runbook.md` accompanying this work, scoped to the
admin UI itself. In scope:

- How to add or remove an admin (edit `ADMIN_USER_IDS` in
  `/etc/guru-web.env`, restart `guru-web`).
- How to reach the admin UI (tailnet hostname, the Tailscale-down
  fallback path = `ssh` + `psql` per §0.5).
- Caddy admin-listener install procedure: edit `/etc/caddy/Caddyfile`,
  `caddy validate`, `systemctl reload caddy`. Rollback by reverting
  the Caddyfile and reloading.
- Tailscale cert renewal: where the renewal script lives, where the
  timer's status is visible, the one-command manual renewal path
  for §0.3.
- Current Tailscale ACL state and where it's managed (tailnet
  admin console).

**Deferred to a separate runbook BRD: psql snippets for
mutations the UI doesn't expose** (tier flip, quota reset,
soft-delete, kill-switch). Adding them now risks turning the admin
runbook into "the place where you find dangerous one-liners," which
is the opposite of what a runbook should be — every snippet
deserves its own pre/post checklist, reverse operation, and example
output. That's a doc in its own right (`docs/operator-mutations.md`
or similar) with its own review pass. Leaving the field empty is
better than leaving it half-filled.

---

## Open questions for review

1. **Backfilled cost accuracy in admin views.** The `cost_usd` backfill
   (scripts/backfill-cost.ts) prices historical rows at *current* rates,
   not the rate that was in effect at query time — pre-backfill traffic
   was logged before `model_pricing` had history to look up. The admin
   UI cannot distinguish backfilled rows from natively-priced rows.
   Worth surfacing? Default: yes, lightly — show a tooltip on any
   pre-backfill date saying "costs estimated at backfill-time rates."
   Argument for ignoring: the discrepancy is small and the calendar
   moves on. Argument for surfacing: future-you debugging a "why did
   spend on March 4 jump" mystery will be confused by the artefact.

2. **Read access logging.** Even with no mutations, the admin UI reads
   user query content (PII, see §1.12). Worth logging which deep-dive
   pages were accessed, by which device, and when? Default: no — the
   tailnet IP attribution is captured in Caddy access logs already, and
   adding a dedicated DB table for "I looked at this user's session" is
   a lot of bookkeeping for a single-operator setup. If the operator
   ever stops being a single person, revisit.

3. **Soft-delete column even without UI control.** Adding `deleted_at`
   to `sessions` and `queries` now (defaulting NULL, no admin write
   path) would make the eventual `psql` snippet for content removal
   non-destructive. Worth it as a one-line migration even though no
   code path uses the column? Default: yes — cheap insurance,
   removes the foot-gun of `DELETE FROM queries` being the only option
   when the operator does need to take something down.
