/**
 * src/app/api/preferences/route.ts
 *
 * GET /api/preferences — load user's tradition scope preferences
 * PUT /api/preferences — update user's tradition scope preferences
 */

import { requireUser } from '@/lib/auth';
import { loadPreferences, savePreferences } from '@/lib/prefs';
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

  // Merge with existing prefs so partial updates are safe
  const existing = await loadPreferences(user.id);
  const updated: UserPreferences = {
    scopeMode:             body.scopeMode             ?? existing.scopeMode,
    blockedTraditions:     body.blockedTraditions     ?? existing.blockedTraditions,
    blockedTexts:          body.blockedTexts          ?? existing.blockedTexts,
    whitelistedTraditions: body.whitelistedTraditions ?? existing.whitelistedTraditions,
    whitelistedTexts:      body.whitelistedTexts      ?? existing.whitelistedTexts,
  };

  await savePreferences(user.id, updated);
  return Response.json(updated);
}
