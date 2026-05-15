/**
 * src/app/api/preferences/route.ts
 *
 * GET /api/preferences — load user's tradition scope preferences
 * PUT /api/preferences — update user's tradition scope preferences
 */

import { requireUser } from '@/lib/auth';
import { loadPreferences, savePreferences } from '@/lib/prefs';
import { isCuratedSlug } from '@/lib/curated-models';
import { isVoiceSlug, DEFAULT_VOICE } from '@/lib/prompt';
import type { UserPreferences } from '@/lib/types';

export async function GET() {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  const prefs = await loadPreferences(user.id);
  return Response.json(prefs);
}

export async function PUT(req: Request) {
  const userOrResponse = await requireUser();
  if (userOrResponse instanceof Response) return userOrResponse;
  const user = userOrResponse;

  let body: Partial<UserPreferences>;
  try {
    body = await req.json() as Partial<UserPreferences>;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate scopeMode
  const validModes = ['all', 'whitelist', 'blacklist'] as const;
  if (body.scopeMode !== undefined && !validModes.includes(body.scopeMode)) {
    return Response.json(
      { error: `scopeMode must be one of: ${validModes.join(', ')}` },
      { status: 400 }
    );
  }

  // Validate preferredModel: must be a CURATED_MODELS slug, null, or
  // unset. Free users may send any of these but the value is ignored
  // at query time per BRD §7.2 (route resolves to tier default for
  // free regardless). Spec: BRD-model-selection.md §6.1.
  if (
    body.preferredModel !== undefined &&
    body.preferredModel !== null &&
    !isCuratedSlug(body.preferredModel)
  ) {
    return Response.json(
      { error: `preferredModel must be a curated slug or null` },
      { status: 400 }
    );
  }

  // Validate preferredVoice: must be a known voice slug. The server-
  // side pro gate is strict: only pro users may write a non-default
  // voice. Free users may write 'scholar' (no-op) but a 'woowoo'
  // attempt is rejected with 403 — the query route also re-checks
  // tier at session-create time, but rejecting the write here keeps
  // stored prefs honest. UI gating alone is not sufficient.
  // Spec: BRD-chat-voice.md §6, IMPL §6.
  if (body.preferredVoice !== undefined) {
    if (!isVoiceSlug(body.preferredVoice)) {
      return Response.json(
        { error: `preferredVoice must be a known voice slug` },
        { status: 400 }
      );
    }
    if (body.preferredVoice !== DEFAULT_VOICE && user.tier !== 'pro') {
      return Response.json(
        { error: 'Pro subscription required to change voice' },
        { status: 403 }
      );
    }
  }

  // Merge with existing prefs so partial updates are safe
  const existing = await loadPreferences(user.id);
  const updated: UserPreferences = {
    scopeMode:             body.scopeMode             ?? existing.scopeMode,
    blockedTraditions:     body.blockedTraditions     ?? existing.blockedTraditions,
    blockedTexts:          body.blockedTexts          ?? existing.blockedTexts,
    whitelistedTraditions: body.whitelistedTraditions ?? existing.whitelistedTraditions,
    whitelistedTexts:      body.whitelistedTexts      ?? existing.whitelistedTexts,
    preferredModel:        body.preferredModel !== undefined
                             ? body.preferredModel
                             : existing.preferredModel,
    preferredVoice:        body.preferredVoice ?? existing.preferredVoice,
  };

  await savePreferences(user.id, updated);
  return Response.json(updated);
}
