/**
 * src/app/api/query/guest/route.ts
 *
 * POST /api/query/guest — the anonymous first-question endpoint
 * (todo:732e73b1). A visitor with no account asks Guru one real question:
 * full corpus retrieval, real citations, the free-tier model and voice, a
 * genuinely streamed answer — the same product an authenticated free user
 * gets, so the first experience is not a demo.
 *
 * What it deliberately does NOT do (everything keyed on a users row):
 *   - no requireUser / Clerk;
 *   - no loadPreferences (uses DEFAULT_PREFERENCES);
 *   - no reserveBudget / finalizeBudget (there is no per-user budget; the
 *     entitlement gate below is the economic control);
 *   - no sessions row, and the persisted queries row carries user_id NULL,
 *     session_id NULL, tier_used 'guest'. On signup that row is adopted in
 *     place (todo:45598ce4).
 *
 * Abuse control is the guest entitlement gate (lib/guest): a one-free-
 * question signed-cookie token, backstopped by a per-IP throttle. Cost is
 * still computed and persisted per row so admin can track guest spend.
 *
 * Flow:
 *   1. Resolve/mint the guest token; extract client IP.
 *   2. Consume one guest question (token one-shot + IP throttle) → 429 if spent.
 *   3. Parse + validate body (same 4000-char cap as /api/query).
 *   4. Retrieve + build prompt with free-tier defaults.
 *   5. Stream the answer (shared machinery), persisting a guest row on completion.
 */

import { retrieve } from '@/lib/retriever';
import { buildPrompt, getSystemPrompt, DEFAULT_VOICE } from '@/lib/prompt';
import { completeStream } from '@/lib/model';
import { buildAnswerStream } from '@/lib/query-stream';
import { DEFAULT_CURATED_SLUG, resolveCuratedModel } from '@/lib/curated-models';
import { DEFAULT_PREFERENCES } from '@/lib/prefs';
import { exec } from '@/lib/db';
import type { ChatMessage } from '@/lib/history';
import {
  GUEST_COOKIE,
  verifyGuestToken,
  mintGuestToken,
  consumeGuestQuery,
  guestTokenHash,
  ipName,
  clientIpFrom,
} from '@/lib/guest';

export const runtime = 'nodejs';

// Mirrors /api/query. Server is the authoritative gate.
const MAX_QUERY_CHARS = 4000;

const GUEST_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, matches the token window

/** Read a single cookie value from the request's Cookie header. */
function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function guestCookie(token: string): string {
  const secure = (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https')
    ? '; Secure'
    : '';
  // HttpOnly: the token never needs to be read by client JS — it rides the
  // request automatically, and the signup adoption reads it server-side.
  return `${GUEST_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${GUEST_COOKIE_MAX_AGE}${secure}`;
}

export async function POST(req: Request) {
  // 1. Resolve or mint the guest token; the entitlement id is the token's
  //    verified inner id. A missing/forged cookie mints a fresh token (and
  //    the IP throttle is what stops cookie-clearing from farming questions).
  const existing = readCookie(req.headers, GUEST_COOKIE);
  const token = verifyGuestToken(existing) ? existing! : mintGuestToken();
  const tokenId = verifyGuestToken(token)!; // freshly minted verifies by construction
  const ip = clientIpFrom(req.headers);

  // 2. Consume one guest question up front (token one-shot, then IP throttle).
  const verdict = consumeGuestQuery(tokenId, ip);
  if (!verdict.allowed) {
    const msg = verdict.reason === 'ip'
      ? 'Too many free questions from your network. Create a free account to continue.'
      : "You've used your free question. Create a free account to keep exploring.";
    return Response.json(
      { error: msg, reason: verdict.reason },
      {
        status: 429,
        headers: {
          'Retry-After': String(verdict.retryAfterSeconds),
          'X-Guest-Remaining': '0',
          'Set-Cookie': guestCookie(token),
        },
      },
    );
  }

  // 3. Parse + validate body.
  let queryText: string;
  try {
    const body = await req.json() as { query?: unknown };
    if (typeof body.query !== 'string' || !body.query.trim()) {
      return Response.json({ error: 'query is required' }, { status: 400 });
    }
    queryText = body.query.trim();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (queryText.length > MAX_QUERY_CHARS) {
    return Response.json(
      { error: `query exceeds ${MAX_QUERY_CHARS}-character limit`, limit: MAX_QUERY_CHARS, length: queryText.length },
      { status: 400 },
    );
  }

  // 4. Retrieve + build prompt with free-tier defaults (full corpus, scholar).
  const prefs = DEFAULT_PREFERENCES;
  const chunks = await retrieve(queryText, prefs);
  const prompt = buildPrompt(queryText, chunks, prefs, 'free');

  const slug = DEFAULT_CURATED_SLUG;
  const modelId = resolveCuratedModel(slug);
  const systemPrompt = getSystemPrompt(DEFAULT_VOICE);

  // Guests have no history — the first question has none by definition.
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: prompt },
  ];

  // 5. Stream. Opening upstream here keeps the 500-on-open contract.
  const stream = await completeStream(messages, modelId, slug);

  const readable = buildAnswerStream({
    stream,
    modelId,
    logTag: 'api/query/guest',
    onComplete: async ({ fullResponse, inputTokens, outputTokens, cachedInputTokens, costUsd }) => {
      try {
        // A guest row: no user_id, no session_id, tier_used 'guest'. Cost is
        // tracked so admin sees guest spend. guest_token_hash keys the signup
        // adoption; ip_name/guest_ip label the row for admin (IP shed on
        // conversion).
        await exec(
          `INSERT INTO queries
             (session_id, user_id, query_text, response_text,
              chunks_used, model_used, tier_used,
              input_tokens, output_tokens, cached_input_tokens, cost_usd,
              guest_ip, ip_name, guest_token_hash)
           VALUES (NULL, NULL, $1, $2, $3, $4, 'guest', $5, $6, $7, $8, $9, $10, $11)`,
          [
            queryText,
            fullResponse,
            JSON.stringify(chunks.map(c => c.id)),
            modelId,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            costUsd,
            ip,
            ipName(ip),
            guestTokenHash(tokenId),
          ]
        );
      } catch (err) {
        console.error('[api/query/guest] persist error:', err);
      }
    },
  });

  // Authoritative citations for the live render — identical shape to /api/query.
  const citationsHeader = chunks.length > 0
    ? encodeURIComponent(JSON.stringify(
        chunks.map(c => ({ id: c.id, tradition: c.tradition, text: c.text_name, section: c.section })),
      ))
    : '';

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Model-Used': modelId,
      // One free question, now spent — the client shows the signup wall
      // after the answer finishes.
      'X-Guest-Remaining': '0',
      'Set-Cookie': guestCookie(token),
      ...(citationsHeader && { 'X-Citations': citationsHeader }),
    },
  });
}
