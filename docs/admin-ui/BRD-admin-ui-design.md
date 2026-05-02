# BRD — Admin UI Design

Sibling to `BRD-admin-ui.md`. The data BRD specifies what must be
observable and the security posture. This doc specifies what the
operator sees and clicks — layout, components, interaction patterns.

The split exists because the data BRD answers questions that don't
change with taste ("must the operator see full prompt content?"
yes — §1.12), and this doc answers questions that do change with
taste ("does the prompt content live in a modal or a `<details>`
expansion?"). Mixing them makes both harder to review.

Out of scope: charts beyond the v1 tabular sparkline (deferred to
`BRD-admin-charts.md` per the data BRD §1.16). Also out of scope:
copy text, microcopy, error message wording — those are decided
during implementation.

---

## 1. Design principles

Five principles, applied throughout. Where a later section seems to
violate one, the violation is intentional and called out.

### 1.1 Density over breathing room

The operator is scanning, not reading. Tables with 8-12 columns at a
12-13px line height beat card grids with 3-4 properties per card.
The default mistake in admin UIs is treating them like marketing
pages; the right reference is `htop`, not Linear.

### 1.2 Tables over dashboards

A sortable table answers more questions per square inch than any
arrangement of cards or charts. Where a chart genuinely beats a
table — the spend-per-day shape is one such case — the table comes
first and the chart is added once a v2 BRD picks a chart library.

### 1.3 URL state is the API

Every filter, every sort, every pagination cursor lives in the URL
as a query parameter. This is what makes the admin UI a tool the
operator uses rather than a page they visit:

- Bookmarkable views ("pro users who haven't queried in 30 days").
- Phone-to-desktop sharing via URL paste.
- Two-tab comparisons of different filter states.
- Browser back/forward works as expected.

The cost is a `useSearchParams` reader on every screen with filters,
plus `router.replace` calls on filter change. Cheap. The benefit
compounds for as long as the UI exists.

### 1.4 Click navigates, doesn't expand

Clicking a row in a list always navigates to a new URL. Inline
expansion (`<details>`) is reserved for content the operator wants
to read alongside its siblings — the chronological queries within
a session, where comparing query 3 to query 5 matters. Expansion
is local, navigation is global; the rule is that anything you'd
want to deep-link to gets a URL.

### 1.5 No third-party UI libraries

No shadcn, no Radix, no MUI, no Chakra. The admin surface uses
native HTML elements (`<table>`, `<details>`, `<select>`) styled
with the existing `tokens.ts` palette. Reasoning:

- The seven components needed (§3) are all small and one-off.
- A library import is a build-time dependency, a security surface,
  and a long-term maintenance commitment for code the operator
  uses for an hour a week.
- Native elements have working keyboard, screen-reader, and
  ctrl-F behaviour for free.

Recharts is the one exception worth considering for v2 (charts
BRD), and even that decision is deferred.

---

## 2. Layout

### 2.1 Two-pane, fixed width

Left rail: 200px wide, fixed. Content pane: max 1280px, fluid until
that cap. Single rule. No responsive breakpoints, no hamburger,
no collapse-on-mobile. The phone case is "tailnet check from
elsewhere" — horizontal scroll on tables is acceptable, layout
gymnastics for a once-a-week phone use case is not.

### 2.2 Persistent admin chrome

Across every admin page, top to bottom:

- Amber 2px bar (`tokens.text.accent`), full width, label
  `ADMIN — observability` left-aligned, current operator's email
  right-aligned. Always visible. The redundancy with the URL bar
  is intentional — the bar is the visual signal that distinguishes
  admin from app even when the operator has both open in adjacent
  tabs.
- Below the bar: the two-pane layout from §2.1.

### 2.3 Left rail contents

Six items, in order:

1. Overview (`/admin`)
2. Users (`/admin/users`)
3. Sessions (`/admin/sessions/[id]` — but the rail item is a
   search box, "jump to session by ID", since there's no useful
   sessions-list view at the operator's scale)
4. Queries (same — search by ID)
5. (placeholder) Audit (`/admin/audit`, only if the data BRD's
   open question #2 lands as "yes")

Mono font for nav labels. No icons. No expand/collapse — the rail
is short enough that nothing needs to fold.

### 2.4 Page header pattern

Every screen except the overview has a header strip below the
admin bar containing breadcrumbs and screen-specific stat tiles.
The breadcrumb is the page title; "User: ivy@example.com" is more
useful as `Users / ivy@example.com` because both segments are
clickable.

### 2.5 No skeletons, no loading states

Server components on a tailnet-local connection load fast enough
that a "Loading…" string is sufficient. Skeleton screens are
performance theatre on this UI.

---

## 3. Component inventory

Seven components. The `<` prefix is shorthand; actual file paths
get decided during implementation.

### 3.1 `<AdminLayout>`

Wraps every admin page. Renders the amber bar, left rail, and
content pane. Reads the operator's email from the Clerk session
to display in the bar. No props beyond `children`. Lives in the
admin route group's `layout.tsx`.

### 3.2 `<StatTile>`

Compact label + value + optional delta. Used in stat-tile rows.

```
| Spend MTD                |
| $24.13                   |
| +$3.20 vs last month     |
```

Three text sizes, three colors (label muted, value primary, delta
muted-with-sign-color). No icons, no border, no background fill —
spacing alone separates tiles. ~30 lines.

### 3.3 `<DataTable>`

The most-used component. Native `<table>`. Features:

- Click column header to sort; click again to reverse; click a
  third time to clear.
- Sort state lives in the URL (per §1.3).
- Row click fires a passed handler — typically navigation.
- Pagination footer when total exceeds page size, also URL-driven.
- Empty state row when no data.
- Sticky header within the content pane.
- "Download CSV" link in the table footer when the surface has a
  paired CSV endpoint (data BRD §1.18). Same URL filters apply,
  so the CSV reflects whatever the operator currently sees.

What it deliberately doesn't do: row selection, bulk actions,
column resize, column reorder, virtualization. The CSV export
covers the "I want the full dataset" need that virtualization
would otherwise serve, without the engineering of a virtualized
table that also supports column sort + filter.

### 3.4 `<TabularSparkline>`

The "v1 chart." Per the data BRD §1.16, this exists to keep the
overview useful without committing to a chart library. Each row
is `[date | count | css-bar]`, 30 rows = 30 days. Stacked variants
render two bars in the same cell with two colors.

```
2026-04-29  ████████░░░░░░░░  47
2026-04-30  ███████████░░░░░  64
2026-05-01  █████████░░░░░░░  52
```

Bar widths: `width: ${(value / max) * 100}%`. The component is
genuinely just `<div>`s. Will be replaced in the charts BRD; the
goal is for that replacement to be a single component swap, not a
data-layer rewrite.

### 3.5 `<BudgetBar>`

Shows `used / limit` with a fill bar. When `limit === null`,
hides the bar and shows a muted "no cap" tag. Two stacked instances
form the dual-axis display from data BRD §1.7 (queries axis +
USD axis).

The null handling is the load-bearing part. The day pro flips to
having a `usd_limit`, this component renders the new axis correctly
without a code change.

### 3.6 `<FilterPills>`

Controlled component over `URLSearchParams`. Each filter is rendered
as an inline pill that pops a small dropdown on click. Free-text
search is rendered as a search input alongside the pills, debounced
~250ms before pushing to the URL.

The component doesn't own any state itself — it reads from
`useSearchParams` and writes via `router.replace`. This is what
makes §1.3 work in practice.

### 3.7 `<ExpandableQuery>`

The heaviest component, used in session and single-query views.
Two states:

- **Collapsed:** one row, showing query text (~80 chars), model,
  cost, tokens, timestamp. Truncation lives here.
- **Expanded:** full prompt, full response, retrieval block (one
  line per `chunks_used` entry as `tradition / text / section`),
  costing breakdown showing the `model_pricing` row used.

Implemented as `<details>`/`<summary>`. Ctrl-F searches inside
collapsed content; this matters because the operator's main
diagnostic flow is "find the query where the user said X." Native
`<details>` does this; a custom expand component built on
`useState` does not.

A nested `<details>` inside the expanded view holds the raw JSON
toggle (data BRD §1.9).

---

## 4. Screens

Five screens. Each section describes the layout and interaction
patterns; the data displayed is specified in the data BRD §1.5–§1.10.

### 4.1 Overview (`/admin`)

Single column, four sections stacked top to bottom:

1. **Stat tile row** — 8 `<StatTile>`s in a flex row. Wraps to two
   rows of 4 below 1280px content width. The order is non-trivial:
   most operationally urgent first (MTD spend, users at risk),
   trailing with the slowest-moving stats (lifetime user count).
2. **Two `<TabularSparkline>` blocks side-by-side** — queries/day
   on the left, spend/day on the right. Same x-axis (last 30 days),
   different y-axis. Side-by-side because divergence between the
   two tells the most interesting stories.
3. **"Top users this week"** `<DataTable>` — 10 rows. Row click →
   user deep dive. Trend arrow column showing change vs prior week
   is the secret weapon here; the absolute number is rarely the
   interesting signal.
4. **"Top sessions this week"** `<DataTable>` — 10 rows. Row click →
   session deep dive.

The whole page should fit in one screen at 1280×800. If sections
overflow, sections are too verbose, not the layout too small.

### 4.2 Users list (`/admin/users`)

Header: breadcrumb (`Users`) and a single stat tile showing total
user count.

`<FilterPills>` row with: tier (free/pro/all), created within
(today/7d/30d/all), has queried (today/7d/30d/never), search box.

`<DataTable>` filling the rest of the pane, columns per data BRD
§1.6 (email, tier badge, created at, last query at, queries 7d,
spend 7d, Stripe link). Row click navigates to user deep dive.

Pagination at 50 rows/page.

### 4.3 User deep dive (`/admin/users/[id]`)

Header strip: breadcrumb (`Users / ivy@example.com`), then a row
of `<StatTile>`s for lifetime stats (account age, queries, spend,
tokens), then two stacked `<BudgetBar>`s for today's daily budget
(query axis + USD axis).

Body, three sections stacked:

1. **Sessions** — `<DataTable>` of all sessions, newest first.
   Columns: title, query count, last activity, total spend. Row
   click → session deep dive.
2. **Preferences** — small inline block, not a table. Mono font.
   `scope_mode`, blocked traditions, whitelisted texts. Read-only.
3. **Recent rate-limit hits** — small `<DataTable>`, last 24h.
   Empty state ("No rate-limit hits in last 24h.") is the common
   case.

No tabs. Cmd-F across the whole page works because everything
is in the DOM at once.

### 4.4 Session deep dive (`/admin/sessions/[id]`)

Header strip: breadcrumb (`Sessions / [id]` and a sub-link to the
owning user, since "this session belongs to ivy@..." is the first
thing the operator wants to know), then `<StatTile>`s for query
count, total spend, total tokens, duration.

Body: a list of `<ExpandableQuery>` instances in chronological
order. Collapsed by default. The operator's primary action on this
screen is "scroll, expand the interesting one, read."

A "Expand all" / "Collapse all" pair of links live above the list
for the case where the operator is doing systematic review of a
session. Implemented as JS-free anchor links to fragment URLs that
toggle a CSS class on the `<main>`; native `<details>` honors
`open` attribute, so this is shorter than it sounds.

### 4.5 Query deep dive (`/admin/queries/[id]`)

Same content as a single expanded `<ExpandableQuery>`, but as a
standalone page. Header strip with breadcrumb (`Queries / [id]`)
and back-link to the owning session.

This screen exists primarily so query IDs are linkable — the
operator's diagnostic flow often involves pasting a query ID into
chat or a notes file, and that paste should resolve to a focused
view rather than a session-deep-dive scrolled to the right anchor.

The "raw JSON" nested `<details>` is the diagnostic surface that
matters most here. Open by default on this screen, closed by
default in the session view.

---

## 5. Interaction patterns

### 5.1 No modals, no toasts, no command palette

Modal dialogs trap focus, break browser back, and never feel like
the right answer. Toasts assume the operator is watching; on a
review-style admin UI, the operator isn't. Command palettes are a
power-user addition that makes sense once the UI has dozens of
screens — five doesn't qualify.

### 5.2 Keyboard

Browser defaults. Tab moves focus, Enter activates, ctrl-F searches
the page. Native `<details>` opens with Enter when the summary is
focused. No custom shortcuts in v1.

### 5.3 Empty states

Every list has a one-line empty state in the same row position
where data would be, not a centered illustration. Examples:

- Users with `created within: today` and no signups today: "No new
  users today."
- Recent rate-limit hits, none: "No rate-limit hits in last 24h."

The empty state copy is the only place where the UI "talks to" the
operator; keep it factual, no apologetic tone.

### 5.4 Errors

If a data fetch fails, the affected section shows a single line:
`Failed to load. <retry>`. The retry link is a plain `<a>` to the
current URL with a cache-buster. The operator's recourse for a
real failure is `journalctl -u guru-web`; the UI doesn't try to
diagnose.

### 5.5 Confirmations

None, because there are no mutations. Removing this entire
category of interaction is one of the upsides of the read-only
scope from the data BRD.

---

## 6. Visual treatment

### 6.1 Palette

`tokens.ts` is the source of truth. Re-uses existing values; no
new admin-only tokens are introduced.

- Background: `bg.deep`
- Surface (table backgrounds, header strip): `bg.surface`
- Borders: `border.subtle`
- Text: `text.primary` for values, `text.muted` for labels
- Tier accent: `tokens.tier.verified` for pro, `text.muted` for
  free
- Admin bar: `text.accent` (amber)

### 6.2 Typography

Two faces:

- Sans (`tokens.font.sans`) for everything except IDs and JSON.
- Mono (`tokens.font.mono`) for: user IDs, session IDs, query
  IDs, Clerk user IDs, model strings, JSON dumps, prompt and
  response content.

`Cormorant Garamond` is *not* loaded on admin pages (data BRD
§1.14). The display font is a product-marketing font; admin is
neither.

### 6.3 Density

Table rows: 28-32px tall. Stat tiles: ~80px tall with three
lines of text. No cards-with-shadows. No rounded corners larger
than 4px.

### 6.4 Color use

The admin bar amber is the only saturated color on the page.
Tier badges use a desaturated variant of `tokens.tier.verified`
to avoid competing with the bar. Trend arrows on the "Top users"
table use sign-only color (positive = muted green, negative =
muted red, no green/red on the absolute numbers themselves).

The principle: the operator's eye should be drawn to the amber
bar (so they always know they're in admin) and to the data, in
that order. Color on every column would defeat both.

---

## 7. Responsiveness

There isn't any. Content has a 1280px max-width and the page
scrolls horizontally on devices narrower than that. The phone
case is a 5% use case, and "horizontal scroll on a wide table"
is a genuinely fine experience on a phone for a tool used to
scan numbers.

The one accommodation: tables with many columns get a
right-edge gradient hinting at horizontal scroll, and the most
critical column (usually the leftmost identifier) is sticky on
horizontal scroll.
