/**
 * src/lib/guest.ts
 *
 * Anonymous "guest" entitlement for the first-question funnel
 * (todo:6e5d50fa). A visitor may ask Guru one free question before the
 * signup wall; this module owns the abuse-control primitives that gate
 * that path — with NO dependency on the users table (a guest has no
 * users row, so lib/rate-limit's DB limiter, whose rate_limits.user_id
 * FKs users, cannot key them — same reason lib/ip-rate-limit exists).
 *
 * Three primitives:
 *
 *   1. A signed guest cookie token — HMAC(secret, randomId). The random
 *      id is the entitlement key; the signature stops a client from
 *      forging fresh ids to mint unlimited free questions. Tampered or
 *      absent tokens verify to null and the caller mints a new one.
 *
 *   2. A two-layer fixed-window gate reusing lib/ip-rate-limit:
 *        - guest-token:<id>  — the one-free-question cap (long window).
 *        - guest-ip:<ip>     — backstop so clearing the cookie (fresh
 *                              id every time) can't farm free questions.
 *      Token is checked FIRST so a legitimate returning visitor whose
 *      one question is spent doesn't also burn IP budget; a cookie-
 *      clearer always presents a fresh id, passes the token check, and
 *      is caught by the IP layer.
 *
 *   3. A stable, deterministic ip-name pseudonym for admin display, so
 *      the dashboard labels a guest "curious-ibis" rather than leading
 *      with a raw IP (PII). Derived from the IP, so the same visitor
 *      reads as the same name across their session.
 *
 * In-memory, per-process state (via lib/ip-rate-limit) is correct for
 * the current single `next start` topology; if that ever fans out,
 * ip-rate-limit's header calls out the move to a shared store.
 */

import { createHash, createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { ipRateLimit, peekIpRateLimit } from './ip-rate-limit';

/** Cookie name carrying the signed guest token. */
export const GUEST_COOKIE = 'guru_guest';

/** Free questions per guest token before the signup wall. */
export const FREE_GUEST_QUERIES = 1;

/** IP backstop: max guest questions per IP per window (defeats cookie-clearing). */
const GUEST_IP_LIMIT = 5;
const GUEST_IP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Token entitlement window. Long, not infinite: a token that stops
 * resetting forever would leak into the map permanently and never let a
 * genuinely returning visitor try again. 30 days is far past any real
 * "read the answer, then sign up" session.
 */
const GUEST_TOKEN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cookie-signing secret. A dedicated GUEST_COOKIE_SECRET wins; otherwise
 * we derive from CLERK_SECRET_KEY (already required + present at boot, so
 * no new required-env plumbing) via a labelled HMAC so the guest key is
 * not the Clerk key verbatim. The insecure literal is a last-resort
 * fallback for unit tests / local dev where neither env is set — it is
 * never reachable in a booted deployment (boot asserts CLERK_SECRET_KEY).
 */
function secret(): Buffer {
  const dedicated = process.env.GUEST_COOKIE_SECRET;
  if (dedicated) return Buffer.from(dedicated);
  const clerk = process.env.CLERK_SECRET_KEY;
  if (clerk) return createHmac('sha256', clerk).update('guru-guest-cookie').digest();
  return Buffer.from('insecure-dev-guest-secret');
}

function mac(id: string): string {
  return createHmac('sha256', secret()).update(id).digest('base64url');
}

/** Mint a fresh signed guest token: `<randomId>.<hmac>`. */
export function mintGuestToken(): string {
  const id = randomBytes(16).toString('base64url');
  return `${id}.${mac(id)}`;
}

/**
 * Verify a signed guest token in constant time.
 * Returns the entitlement id on success, or null if absent/malformed/forged.
 */
export function verifyGuestToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const id = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(id));
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  return id;
}

/**
 * Deterministic hash of the entitlement id, stored on the guest's queries
 * row (queries.guest_token_hash) and recomputed at signup to adopt that
 * row (todo:45598ce4). We store the hash, not the raw id, so the DB never
 * holds the live cookie value.
 */
export function guestTokenHash(tokenId: string): string {
  return createHash('sha256').update(tokenId).digest('hex');
}

export interface GuestVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
  /** Which layer denied, for telemetry. null when allowed. */
  reason: 'token' | 'ip' | null;
}

const TOKEN_KEY = (tokenId: string) => `guest-token:${tokenId}`;
const IP_KEY    = (ip: string)      => `guest-ip:${ip}`;

/**
 * Non-consuming pre-flight check for (tokenId, ip): is a free question
 * available right now? Use this to reject an already-spent guest BEFORE
 * doing any work (retrieval, model call), without burning their question —
 * the actual consume happens once we're committed to producing an answer.
 * Token layer first (see module header for ordering rationale).
 */
export function peekGuestQuery(tokenId: string, ip: string): GuestVerdict {
  const tok = peekIpRateLimit(TOKEN_KEY(tokenId), FREE_GUEST_QUERIES);
  if (!tok.allowed) return { allowed: false, retryAfterSeconds: tok.retryAfterSeconds, reason: 'token' };
  const ip_ = peekIpRateLimit(IP_KEY(ip), GUEST_IP_LIMIT);
  if (!ip_.allowed) return { allowed: false, retryAfterSeconds: ip_.retryAfterSeconds, reason: 'ip' };
  return { allowed: true, retryAfterSeconds: 0, reason: null };
}

/**
 * Consume one guest question for (tokenId, ip). Call this only at the point
 * of commitment — after the body validates and the model stream has opened —
 * so a 400/429/500 never burns the visitor's one free question. Token layer
 * first. (peekGuestQuery → consumeGuestQuery has a benign TOCTOU: two truly
 * concurrent first-questions can both pass the peek and over-grant by one;
 * the IP layer bounds it.)
 */
export function consumeGuestQuery(tokenId: string, ip: string): GuestVerdict {
  const tok = ipRateLimit(TOKEN_KEY(tokenId), FREE_GUEST_QUERIES, GUEST_TOKEN_WINDOW_MS);
  if (!tok.allowed) {
    return { allowed: false, retryAfterSeconds: tok.retryAfterSeconds, reason: 'token' };
  }
  const ip_ = ipRateLimit(IP_KEY(ip), GUEST_IP_LIMIT, GUEST_IP_WINDOW_MS);
  if (!ip_.allowed) {
    return { allowed: false, retryAfterSeconds: ip_.retryAfterSeconds, reason: 'ip' };
  }
  return { allowed: true, retryAfterSeconds: 0, reason: null };
}

/** Adjective + creature wordlists for the ip-name pseudonym. */
const ADJECTIVES = [
  'curious', 'quiet', 'wandering', 'hidden', 'ancient', 'gentle', 'restless',
  'luminous', 'shadowed', 'seeking', 'patient', 'distant', 'nameless', 'silent',
  'wakeful', 'errant',
];
const CREATURES = [
  'ibis', 'heron', 'jackal', 'owl', 'moth', 'raven', 'lynx', 'serpent',
  'falcon', 'hare', 'stag', 'wolf', 'crane', 'fox', 'viper', 'swift',
];

/**
 * Deterministic pseudonym for a guest IP, e.g. "curious-ibis". Stable
 * for a given IP so the admin dashboard can follow one visitor across
 * their questions without surfacing the raw IP as the primary label.
 */
export function ipName(ip: string): string {
  const h = createHmac('sha256', 'guru-ip-name').update(ip).digest();
  const adj = ADJECTIVES[h[0] % ADJECTIVES.length];
  const creature = CREATURES[h[1] % CREATURES.length];
  return `${adj}-${creature}`;
}

/**
 * Read a single cookie value from a request's Cookie header. Shared by the
 * guest query and convert routes so cookie-parsing lives in one place.
 */
export function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Extract the client IP from request headers. Caddy fronts prod; the
 * first hop of x-forwarded-for is the real client. Mirrors the helper
 * in read/search. Falls back to 'local' for direct/dev requests.
 */
export function clientIpFrom(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}
