# BRD — Model Selection + USD Budget Cap

Source: pre-launch cost concern. Pro is being priced at **$15/month**.
A heavy user on the current pinned `anthropic/claude-sonnet-4.5`
($3/$15/Mtok) at 30 queries/day with realistic 10k-token retrieval
contexts spends ~$40.50/month against a ~$13.75 net. That's negative
gross margin in the worst case and uncomfortable in the typical case.
This BRD changes the model from "pinned per tier" to "curated picker
with USD cap" and adds a stable slug indirection so we can roll
versions forward without coordinating with users.

Out of scope: streaming changes, prompt template changes, retrieval
changes, opening the picker to all OpenRouter models. The picker is
deliberately curated.

---

## 1 Decision summary

1. **Free** stays single-model. Default switches from
   `deepseek/deepseek-chat` to `deepseek/deepseek-v4-pro` (newer,
   marginally pricier, materially better quality, includes cached-
   input pricing). No picker. Hard query cap (10/day) stays.
2. **Pro** gets a 4-option curated picker covering the four
   providers the operator wants visible: DeepSeek, X.AI, Anthropic,
   OpenAI. Default is the same DeepSeek model as free — the picker
   is opt-up, not opt-in.
3. **Pro budget axis flips to USD-primary.** `usd_limit` becomes
   non-null for pro; `query_limit` stays as a soft secondary gate.
   Daily $0.20 cap → $5/30d budget. Math in §3. The dual-axis
   enforcement code in `src/lib/spend.ts` already handles this; only
   `TIER_LIMITS` changes.
4. **Stable provider-name slug** (`anthropic`, `openai`, `xai`,
   `deepseek`) lets us bump versions without touching user data,
   while keeping the picker honest — the user always sees the
   actual model ID alongside the slug. §5.

The architecture for both moves already exists. This is mostly
config + UI + a small server-side resolver.

---

## 2 Why curate, not open the catalog

OpenRouter has 600+ models. A free-form picker is the wrong UX for
this product:

- Most models perform worse on this workload than the four below.
- A bad pick burns the user's USD cap on output that doesn't
  satisfy the query, and they blame us, not OpenRouter.
- Some catalog entries are routing meta-products (`openrouter/auto`,
  `openrouter/free`) with non-obvious pricing semantics.
- Curation gives us one place to upgrade when new versions ship.

A curated 4-pick is also enough surface area for a thoughtful user.
"Cheap, smart, premium-Anthropic, premium-OpenAI" covers the
decision space.

---

## 3 Pricing analysis

Live OpenRouter rates (`/api/v1/models`, fetched 2026-05-02). The
**$/query** column assumes the realistic Guru workload: 10k input
tokens (corpus retrieval is dense) + 1k output tokens, cache cold.
The **$/mo** column is 30 queries/day × 30 days, the worst case for
a daily-driver pro user.

| Model | in $/Mtok | out $/Mtok | cached in | $/query | $/mo @ 30/day |
|---|---:|---:|---:|---:|---:|
| `deepseek/deepseek-v4-pro` | 0.435 | 0.870 | 0.0036 | $0.0052 | $4.70 |
| `deepseek/deepseek-chat` (current free) | 0.32 | 0.89 | — | $0.0041 | $3.68 |
| `x-ai/grok-4.1-fast` | 0.20 | 0.50 | 0.05 | $0.0025 | $2.25 |
| `x-ai/grok-4.3` | 1.25 | 2.50 | 0.20 | $0.0150 | $13.50 |
| `anthropic/claude-haiku-4.5` | 1.00 | 5.00 | 0.10 | $0.0150 | $13.50 |
| `openai/gpt-5.4-mini` | 0.75 | 4.50 | 0.075 | $0.0120 | $10.80 |
| `openai/gpt-5.4` | 2.50 | 15.00 | 0.25 | $0.0400 | $36.00 |
| `anthropic/claude-sonnet-4.6` | 3.00 | 15.00 | 0.30 | $0.0450 | $40.50 |
| `anthropic/claude-opus-4.7` | 5.00 | 25.00 | 0.50 | $0.0750 | $67.50 |
| `openai/gpt-5.5` | 5.00 | 30.00 | 0.50 | $0.0800 | $72.00 |
| `openai/gpt-5.5-pro` | 30.00 | 180.00 | — | $0.4800 | $432.00 |

The "frontier" models (Sonnet 4.6, GPT-5.4, Grok 4.3) cluster
between $13.50 and $40.50/mo at full usage. `deepseek-v4-pro` is the
cost floor by an order of magnitude; `gpt-5.5-pro` is so far off the
chart it's offered as a counter-example, not a candidate.

Cached-input rate matters more than it looks. Guru's prompts
re-include the same retrieved chunks across follow-up queries in a
session. DeepSeek-v4-pro's $0.0036 cached rate is ~120× cheaper than
its uncached rate; Sonnet's 0.30 is ~10×. A multi-turn session on
DeepSeek with cache hits drops to ~$0.001/query.

### 3.1 Pro economics at $15/mo

```
Stripe fees (2.9% + $0.30):           -$0.74
Net per pro user:                      $14.26
Infra share (CX22 + DB + ollama):      -$0.50
Net before model bill:                 $13.76
```

Sustainable margin floor is ~50% on the gross — leaves **$6–7/mo
max model spend per user**, with $5/mo as a comfortable target. The
USD cap below is set to that.

### 3.2 Cap interaction with each curated pick

USD cap = $5/month (= $0.166/day). Where the cap binds for a
30-query/day power user:

| Pick | $/mo @ 30/day | Cap binds at | Effective free queries/day |
|---|---:|---|---:|
| DeepSeek V4 Pro | $4.70 | never | 30 (full query cap) |
| Grok 4.3 | $13.50 | day ~11 | ~11 |
| Sonnet 4.6 | $40.50 | day ~3.7 | ~3–4 |
| GPT-5.4 | $36.00 | day ~4.2 | ~4 |

The intended UX: pick a frontier model, get fewer-but-deeper queries
per day. Pick DeepSeek, get the full daily allowance. The cap turns
"model picker" into a self-service quality/quantity tradeoff.

A casual user (~5 queries/day) on Sonnet hits ~$0.225/day = ~$6.75/
month — slightly over the $5 cap. They'd see the cap kick in around
day 22. Two ways to read this:

- **As designed**: a casual user on the most expensive model still
  bumps the cap, signalling that Sonnet-every-day at $15/mo isn't
  what we're selling. They self-regulate by picking Grok or
  DeepSeek for non-critical queries.
- **As friction**: $5 cap with Sonnet feels stingy. Counter-argument:
  $5 of Sonnet at typical token counts is ~110 queries; a user
  hitting that ceiling is a power user, and we want them to feel
  the price signal.

The cap value is reversible (single line in `TIER_LIMITS`). Ship at
$5; bump if churn data says it's too tight.

---

## 4 Curated list

### 4.1 Free tier

Single model, no picker.

| Slug | Resolves to (today) | Why |
|---|---|---|
| `deepseek` | `deepseek/deepseek-v4-pro` | Best floor on quality+price. Replaces `deepseek-chat`. |

Free user lifetime cost ceiling: 10 queries/day × 30 days × $0.0052
= **$1.56/mo** (no USD cap needed; query cap dominates).

### 4.2 Pro tier

Four-option picker. Slugs are the **provider name**; the resolved
OpenRouter ID is shown alongside the slug in the picker so the user
always knows the actual model.

| Slug | Resolves to (today) | Vibe |
|---|---|---|
| `deepseek` *(default)* | `deepseek/deepseek-v4-pro` | Cheap, fast, surprisingly capable on this corpus. |
| `xai` | `x-ai/grok-4.3` | Mid-cost, current-events fluency, conversational. |
| `anthropic` | `anthropic/claude-sonnet-4.6` | Best on long-context reasoning over esoteric texts. |
| `openai` | `openai/gpt-5.4` | Premium-quality, slightly cheaper than Sonnet. |

Why GPT-5.4 not 5.5: 5.5 is $5/$30/Mtok, ~80% more expensive than
5.4 for marginal quality gain at this workload. We can revisit when
5.5 stabilises and cheaper variants drop. **Why Sonnet 4.6 not Opus
4.7**: Opus is 1.7× more expensive on output for diminishing returns
on retrieval-heavy queries. Add Opus only if the cap is bumped to
$8+ later.

### 4.3 Why no Haiku / Grok-fast / GPT-5.4-mini

Considered. They sit in a $10–14/mo @ 30/day range that overlaps
with Grok 4.3 without offering a meaningful quality jump in either
direction. A 4-option picker is already at the "I don't know which
to pick" threshold; a 7-option picker is worse.

If telemetry post-launch shows pro users mostly running cheap
queries, we can replace Sonnet 4.6 in the picker with Haiku 4.5 to
shift the average cost down. Reversible.

---

## 5 The "latest" problem

Operator wants users to silently roll forward when new model
versions ship — without "Anthropic finally released Sonnet 5" being
a five-step manual re-pick for every pro user. OpenRouter doesn't
have a `:latest` alias to delegate this to; every ID is pinned.

### 5.1 Provider-name slug + model surface (chosen)

User picks a slug — `anthropic`, `openai`, `xai`, or `deepseek`.
Slugs are stable; the OpenRouter ID they resolve to is bumped by
the operator on new releases. Map lives in code:

```ts
// src/lib/model.ts (additive)
export const CURATED_MODELS = {
  deepseek:  'deepseek/deepseek-v4-pro',
  xai:       'x-ai/grok-4.3',
  anthropic: 'anthropic/claude-sonnet-4.6',
  openai:    'openai/gpt-5.4',
} as const;
export type CuratedSlug = keyof typeof CURATED_MODELS;
```

`/api/query` resolves the slug to the OpenRouter ID and stores the
**resolved ID** in `queries.model_used`. `model_pricing` keys on the
resolved ID (already true today). When we bump a slug → ID mapping:

1. PR edits the map.
2. `npm run sync-pricing` populates `model_pricing` for the new ID
   if it's not there yet.
3. Deploy. Existing pro users with `anthropic` saved get the new
   ID on their next query without any user action.
4. The historical record in `queries` and `model_pricing` stays
   correct — old queries reference old IDs at old prices.

The slug is operator-facing config. The user always sees the
**resolved model ID** in two places:

1. **Picker option label.** Each row in the settings picker reads
   like `Anthropic — claude-sonnet-4.6` (provider title-cased,
   model from `CURATED_MODELS[slug]`). When we bump Anthropic to
   Sonnet 5, the label updates automatically — no copy migration.
2. **Per-response attribution line.** Below every AI response in
   the chat view, a small mono-font line: `claude-sonnet-4.6 ·
   1.4k tokens · $0.021`. Sourced from `queries.model_used`,
   `queries.{input,output}_tokens`, and `queries.cost_usd`. The
   first field is the resolved ID, so the user can see exactly
   which model produced this answer — useful for diagnostics
   ("Sonnet wrote this one but DeepSeek wrote that one") and for
   comparing answers across the picker.

The combination is what makes the indirection honest: a stable
slug for "I prefer this provider" + a real model name in every
place the user could care about it. The slug is not user-facing
copy ("Anthropic"), it's a config primitive.

Stripe-style: subscriptions sit on stable products; we change what
the product points at on our side, and we tell the user exactly
what they got.

### 5.2 Why not store OpenRouter IDs directly

The alternative is to store `anthropic/claude-sonnet-4.6` in
preferences and force users to re-pick on each version release. Two
problems:

- It pushes the upgrade decision to every user instead of the
  operator. Silent rollouts become impossible.
- Stale preference rows accumulate across deprecated IDs that
  OpenRouter eventually retires; we'd need a migration each time.
- The picker label and the chat attribution line stop disagreeing —
  with slug indirection, both surfaces read from the same resolved
  ID, so a user who picks "Anthropic — claude-sonnet-4.6" today
  sees "claude-sonnet-5" on responses post-bump without confusion.

The slug indirection costs one short map and one resolver call. The
audit trail (resolved ID in `queries.model_used`) is preserved.

### 5.3 When to bump

Operator action. Triggers:
- Anthropic releases Sonnet 5 → bump the `anthropic` entry in `CURATED_MODELS`.
- Provider deprecates an ID we point at → forced bump (OpenRouter
  emails about this; also visible in the admin UI overview when
  spend on that model goes to zero unexpectedly).
- A cheaper-and-better variant drops within an existing slot →
  judgment call; usually wait a few weeks for stability before
  bumping.

Process: edit `CURATED_MODELS`, run `npm run sync-pricing` to seed
the new row in `model_pricing`, open PR, merge. No data migration.

### 5.4 What if a slug points at a now-missing ID

Defense in depth: the `complete()` call resolves the slug at query
time. If the resolved ID isn't in `model_pricing`, the cost
calculation falls back to zero (existing behaviour) and the query
still completes — OpenRouter has a stable ID even if our pricing
sync is stale. Admin UI's overview surfaces "queries with NULL
cost_usd" as a soft alarm. **Won't ship a stricter check** because
"refuse to serve user query because of internal accounting state"
is the wrong prioritisation.

---

## 6 Schema changes

### 6.1 user_preferences gains preferred_model

```sql
-- migration 009_user_model_pref.sql
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS preferred_model TEXT;
```

Nullable. Null means "use the tier default" (resolved at request
time from `MODELS[tier]` for legacy semantics, or
`CURATED_MODELS['deepseek']` after this BRD lands). Storing
the slug, not the resolved ID.

Validation: server-side check on write that the value is a key of
`CURATED_MODELS` or null. Rejects anything else with 400. Free
users may save a preference but it's ignored at query time (free is
always pinned).

### 6.2 user_budgets stays as-is

The schema already supports dual-axis. Only `TIER_LIMITS` in
`src/lib/spend.ts` changes:

```ts
export const TIER_LIMITS = {
  free: { query_limit: 10,   usd_limit: null },        // unchanged
  pro:  { query_limit: 100,  usd_limit: 5.00 },        // was: { 30, null }
};
```

`query_limit: 100` for pro is a soft secondary gate to prevent a
runaway loop hitting OpenRouter at $0.005/query × thousands. It
should never be the binding constraint in normal use.

`reserveBudget` already gates on whichever axis is non-null and
binds first; no logic changes (`src/lib/spend.ts:101`).

### 6.3 model_pricing already covers the new IDs

`PROVIDER_ALLOWLIST` in `scripts/sync-pricing.ts` includes
`anthropic`, `openai`, `x-ai`, `deepseek` — the four providers in
the picker. Operator runs `npm run sync-pricing` once before merge;
the new IDs land in `model_pricing` automatically.

---

## 7 Code changes

### 7.1 Server: src/lib/model.ts

Add the curated map. `complete()` and `completeStream()` keep their
`tier: Tier` signature for backwards compatibility, but a new
overload accepts `slug: CuratedSlug` and resolves to the ID.
`/api/query` decides which to use based on whether the user has a
preference saved (pro) or not (free, or pro on default).

### 7.2 /api/query

Pseudocode:

```ts
const tier = user.tier;
const slug = tier === 'pro' && prefs.preferred_model
           ? prefs.preferred_model
           : 'deepseek';                              // tier default
const modelId = CURATED_MODELS[slug];

// reserveBudget against $0.20/day & $5/30d cap (computed estimate
// using model_pricing for modelId × estimated tokens). Existing
// shape; no caller change beyond the modelId substitution.

const response = await complete(prompt, modelId);
// queries.model_used ← modelId   (resolved, not slug)
// queries.cost_usd   ← actual    (finalizeBudget true-up)
```

### 7.3 Settings UI

`/settings` gains a "Model" section, **pro-only**. Four radio
options. Each row reads as `<provider> — <resolved model id>`,
with a price hint and short vibe description:

```
Model:
  [○] DeepSeek  — deepseek-v4-pro     cheap, fast            ~$0.005/query
  [○] X.AI      — grok-4.3            mid-cost, fluent       ~$0.015/query
  [●] Anthropic — claude-sonnet-4.6   premium reasoning      ~$0.045/query
  [○] OpenAI    — gpt-5.4             premium                ~$0.040/query
```

The model-id portion is rendered from `CURATED_MODELS[slug]` at
render time — when the operator bumps Anthropic to Sonnet 5, this
row updates with no copy change. The price hints are static
strings sourced from this BRD's table at PR time; they're
approximate guidance, not real-time. Real-time "you've used $X.XX
of $5.00 this period" lives below the picker using existing
`/api/quota` data (already returns dual-axis).

Free users see the section disabled with a "Pro only" tag and a
link to upgrade.

### 7.4 Chat response attribution

Each AI response in the chat view gets a small mono-font line
below the rendered text:

```
gpt-5.4 · 4.2k tokens · $0.018
```

Sourced from `queries.model_used` (resolved ID), the token columns,
and `cost_usd`. This is the user-facing "what model produced this"
surface. It also makes pricing legible per response — useful both
for the user's own budgeting and for picker comparisons (run the
same query through two different picker choices and compare both
the answer and the cost line).

`tokens.text.muted` colour, smaller than body, no border or
background. Doesn't compete visually with the response itself.
Existing `<ChatView>` already has the data plumbed in — this is
~15 lines.

### 7.4 Admin UI

No changes needed beyond what already shipped. The user deep dive's
preferences snapshot will display `preferred_model: anthropic` (or
whichever provider slug); the
session/query deep dives already show the resolved `model_used` per
query and the `model_pricing` row used. The dual-axis BudgetBar
already renders the now-non-null `usd_limit` correctly (BRD §1.7
prophesied this).

---

## 8 Operator workflow on a model release

Captures the full bump cycle so future-you isn't reverse-engineering
this from the code:

1. Confirm the new ID exists on OpenRouter
   (`curl -sS https://openrouter.ai/api/v1/models | jq '.data[].id' | grep <pattern>`).
2. Eyeball pricing: is it within the cap budget assumption? If a
   provider drops a 2× more expensive flagship, may need to keep the
   old ID pinned and skip a generation.
3. Edit `CURATED_MODELS` in `src/lib/model.ts`.
4. `npm run sync-pricing` to seed the new row.
5. Update the BRD §3 pricing table (this section bit-rots; freshen
   it on every bump).
6. PR; merge after CI green.
7. Spot-check the next user query in the admin UI — `model_used`
   should be the new ID with a fresh `pricing_effective_from`.

---

## 9 Migration & rollout

Single-migration, single-PR, zero-downtime:

1. Migration 009 adds `preferred_model` (nullable). Deploy applies
   automatically.
2. `TIER_LIMITS` change kicks in on the next `reserveBudget` call —
   atomic UPSERT rewrites `usd_limit` per user. No backfill needed.
3. Free users transition from `deepseek-chat` to `deepseek-v4-pro`
   silently; cost difference is rounding error.
4. Pro users on Sonnet 4.5 transition to **`deepseek`** as
   the new default, **even if they were happy on Sonnet**. The
   settings UI ships in the same PR; an in-app one-time banner on
   `/chat` for pro users links to settings: "Pro now lets you pick
   your AI model. Default switched to DeepSeek for cost reasons —
   change it in Settings if you'd rather use Anthropic, OpenAI, or
   X.AI." Banner dismissible; preference saved in localStorage so
   it doesn't reappear.

The banner is the only piece of "marketing" copy in the change.
Without it the silent default switch surprises users mid-session.

---

## 10 Out of scope

- Per-query model override (a "use Sonnet for this one" button).
  Defer until telemetry shows demand.
- Free-form OpenRouter ID picker. As §2.
- Streaming-vs-non-streaming choice — both stream today; no change.
- Charging differently per model. The cap is the only price signal.
- Tokens-as-currency UI (showing tokens spent rather than dollars).
  Tokens are the wrong unit for users; dollars are the right one.

---

## 11 Tests

- `src/__tests__/model.test.ts` (new) — `CURATED_MODELS` slugs are
  exhaustive; resolver returns correct ID; unknown slug throws.
- `src/__tests__/api.test.ts` (extend) — `/api/query` with
  `preferred_model = 'anthropic'` calls `complete()` with
  `anthropic/claude-sonnet-4.6`; `null` falls through to default.
- `src/__tests__/spend.test.ts` (extend) — `reserveBudget` denies
  when `usd_used + estimate > usd_limit` even when `queries_used <
  query_limit`. (Probably already covered; verify.)
- Settings page test — read URL state, write preference, persists
  through reload.

Smoke check post-deploy:
```bash
# Each curated slug round-trips a real OpenRouter call
for slug in deepseek xai anthropic openai; do
  curl -X POST $TEST_URL/api/query \
    -H "Cookie: $PRO_USER_SESSION" \
    -d '{"query":"hi","preferred_model":"'$slug'"}' \
    | jq '.model_used'
done
```

---

## 12 Implementation phases

1. **Schema + server-side defaults** — migration 009, `TIER_LIMITS`
   change, `CURATED_MODELS` map, `/api/query` resolver. Free users
   silently move to `deepseek-v4-pro`. Pro users silently move to
   the same default. No UI changes yet.
2. **Settings UI** — pro picker, preference write, in-app banner
   for the default-switch announcement.
3. **Telemetry pass** — after one week, look at:
   - which slugs pro users actually pick (admin UI users list +
     deep dives surface `preferred_model`),
   - distribution of `cost_usd` per pro user against the $5 cap,
   - any users hitting cap before query cap (signals whether USD or
     query is the binding constraint in practice).
4. **Reactive bumps** — adjust the curated list, the cap, or both
   based on §12.3 data. Each is a one-line PR.

Phase 1 is shippable on its own and is the minimum that addresses
the original cost concern. Phase 2 is the UX that justifies pro
pricing being model-flexible. Phase 3+ is how we keep the picker
honest over time.
