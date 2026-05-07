# BUGFIX — OpenRouter provider routing for prompt caching

**Type:** bug
**Severity:** cost regression — silent
**Source:** PR #52 (multi-turn conversation continuity) manual verification
revealed `cached_input_tokens: 0` on a 12,462-token request that shared
~11K tokens of prefix with a request 77 seconds prior.

## What's broken

Prompt caching is not happening on the dominant model
(`deepseek/deepseek-v4-pro`) even though OpenRouter docs claim DeepSeek
auto-caches. Every multi-turn session pays full input rate on every turn
for the system prompt + replayed prior turns, when those tokens should
be reading from cache at ~1% of the input rate.

The OpenRouter `/api/v1/generation?id=...` lookup confirms it
authoritatively, on a real production turn 2:

```json
{
  "model":              "deepseek/deepseek-v4-pro-20260423",
  "provider_name":      "AtlasCloud",
  "native_tokens_prompt":  12462,
  "native_tokens_cached":      0,
  "usage_cache":            null,
  "response_cache_source_id": null
}
```

Not a streaming-vs-final-usage discrepancy; not a prefix-instability
problem. The cache simply isn't being read.

## Diagnosis

OpenRouter routes most model slugs across multiple upstream providers
(canonical DeepSeek API, AtlasCloud, Together, Fireworks, etc.) for
cost/availability reasons. Auto-caching is a feature of *each upstream
provider*, not of OpenRouter itself. AtlasCloud is a third-party hoster
that runs the deepseek weights without exposing the provider's
cache-tier infrastructure.

The "deepseek auto-caches" claim is true *for DeepSeek's canonical
endpoint*. We're being routed to AtlasCloud, which doesn't.

This affects all auto-caching providers in the curated picker that have
multiple upstream options. Not just DeepSeek.

## Fix

Pass an OpenRouter `provider` extension on every chat-completions
request, preferring the canonical provider for the model. Allow
fallbacks so transient canonical-provider outages don't take down the
endpoint.

```ts
client().chat.completions.create({
  model: modelId,
  messages,
  // ... other fields
  provider: {
    order: [preferredProviderFor(modelId)],
    allow_fallbacks: true,
  },
} as never);                  // OpenAI SDK type doesn't include `provider`
```

`as never` (or `as any`) is required because the OpenAI SDK doesn't
type OpenRouter extensions. Localized to the single call site in
`completeStream`.

## Code changes

### `src/lib/curated-models.ts`

Add a parallel map of preferred upstream provider names. Additive — no
existing consumer breaks.

```ts
/**
 * Per-slug preferred upstream provider name, used in the OpenRouter
 * `provider.order` extension to keep prompt caching reachable. Without
 * this, OpenRouter may route to third-party hosters (AtlasCloud, etc.)
 * that don't expose the upstream's cache tier.
 *
 * Spec: BUGFIX-openrouter-provider-routing.md.
 */
export const PREFERRED_PROVIDER: Record<CuratedSlug, string> = {
  deepseek:  'DeepSeek',
  xai:       'xAI',
  anthropic: 'Anthropic',
  openai:    'OpenAI',
};

export function preferredProviderFor(slug: CuratedSlug): string {
  return PREFERRED_PROVIDER[slug];
}
```

The provider names must match OpenRouter's canonical strings exactly.
Verify against `https://openrouter.ai/api/v1/models/{model}/endpoints`
before committing — typos silently fall back to default routing
(`allow_fallbacks: true` masks the error).

### `src/lib/model.ts`

`completeStream` learns the slug so it can look up the preferred
provider. Two options:

1. Add a third parameter `slug: CuratedSlug` and have the route pass it.
2. Reverse-lookup the slug from the resolved id inside `completeStream`.

Option 1 is cleaner — the route already has the slug in scope (line 127
of `route.ts`). Pass it explicitly. Don't re-derive.

```ts
import { preferredProviderFor, type CuratedSlug } from './curated-models';

export async function completeStream(
  messages: ChatMessage[],
  modelId: string,
  slug: CuratedSlug,
) {
  return client().chat.completions.create({
    model: modelId,
    messages,
    temperature: 0.3,
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
    provider: {
      order: [preferredProviderFor(slug)],
      allow_fallbacks: true,
    },
  } as never);
}
```

### `src/app/api/query/route.ts`

Pass `slug` into the `completeStream` call. The slug is already
resolved earlier in the function (line 127); just thread it through.

```ts
const stream = await completeStream(messages, modelId, slug);
```

### `src/__tests__/api.test.ts`

The mock `completeStream` will receive a third positional argument.
Update assertions on call signature:

```ts
const [messages, modelId, passedSlug] = mockStream.mock.calls[0]!;
expect(passedSlug).toBe('deepseek');
```

Add one targeted assertion that the request body emitted to OpenRouter
includes the `provider.order` field. Achievable by adding a
deeper-inspection mock — or, more simply, by trusting the small wrapper
and asserting only that `completeStream` is invoked with the right
slug. The latter is enough.

## Done when

- `npx tsc --noEmit` clean.
- `npx vitest run` clean.
- Manual verification: replay a multi-turn session against staging
  with the deepseek model, look up turn 2's generation via
  `GET /api/v1/generation?id=...`, confirm
  `provider_name: "DeepSeek"` and `native_tokens_cached > 0`.
- Same verification against the openai and xai curated models — for
  each, `provider_name` matches the canonical and
  `native_tokens_cached` is non-zero on a follow-up turn.
- The `cached_input_tokens` column in the `queries` table reflects the
  same, observable in the admin session view.

## Out of scope (separate work)

- **Anthropic `cache_control` markers.** Anthropic doesn't auto-cache
  even on its canonical endpoint — it requires explicit
  `cache_control: { type: 'ephemeral' }` markers on the messages you
  want cached. That's a feature, not a bug fix (it adds behavior that
  doesn't exist today). The provider routing in this PR is a
  precondition for it (markers without canonical Anthropic routing
  still don't help), but the marker work is separate. Tracked as the
  BRD-conversation-continuity §8 phase 3 item; convert to its own
  ticket when admin telemetry shows poor cache-hit rates on Anthropic
  pro users.
- **Persisting `provider_name` on the `queries` row.** Useful
  observability (would have surfaced this bug faster), but additive
  and out of scope here.

## Risk

- **Reduced routing flexibility.** Forcing canonical providers means
  during a canonical-provider outage, requests fall back to whatever
  OpenRouter routes next — including AtlasCloud, just like today.
  `allow_fallbacks: true` keeps availability identical to current
  behavior. The only "regression" possible is at peak canonical-provider
  load, where queueing latency might be marginally higher than the
  third-party hosters; for our query volume this is negligible.
- **Provider-name typos.** OpenRouter silently falls back when a
  preferred provider doesn't match any known upstream string.
  Mitigated by the manual verification step (would catch a typo on
  any of the four models). A future test could pin the strings against
  OpenRouter's `/models/{id}/endpoints` response, but that's API
  network in unit tests — defer.
- **Cost calibration.** `computeCost` already uses the cached input
  rate for cached tokens. Once caching starts hitting, the post-stream
  `finalizeBudget` will charge less than the pre-flight estimate. That
  difference is *credited* back to `usd_used` (the existing
  reconciliation logic handles this — see comment at
  `route.ts:116-120`). No change needed; the savings just start
  showing up.
