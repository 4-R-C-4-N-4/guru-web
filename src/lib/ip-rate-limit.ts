/**
 * src/lib/ip-rate-limit.ts
 *
 * Fixed-window in-memory rate limiter for PUBLIC unauthenticated surfaces
 * (first user: /read/search, todo:3c342f3b — every search costs an Ollama
 * embed + two corpus scans on a small VPS). The DB-backed lib/rate-limit
 * cannot serve here: rate_limits.user_id has an FK to users, so it only
 * keys authenticated callers.
 *
 * Per-process state is the right scope for the current topology (a single
 * `next start` process behind Caddy). If that ever changes, move this to a
 * shared store — do not fan out silently.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Sweep expired windows once the map gets big, so idle IPs don't leak. */
function sweep(now: number): void {
  if (windows.size < 10_000) return;
  for (const [k, w] of windows) {
    if (w.resetAt <= now) windows.delete(k);
  }
}

export interface IpRateVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function ipRateLimit(key: string, limit: number, windowMs: number): IpRateVerdict {
  const now = Date.now();
  sweep(now);
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (w.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  w.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Non-mutating check: is a call under the limit RIGHT NOW, without consuming
 * a slot or creating a window? Used to reject over-quota callers before doing
 * expensive work, deferring the actual increment (ipRateLimit) to the point
 * of commitment. An absent or expired window reads as allowed and is left
 * untouched.
 */
export function peekIpRateLimit(key: string, limit: number): IpRateVerdict {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
  if (w.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Extract the client IP used as the rate-limit key. Caddy fronts prod, so the
 * first hop of x-forwarded-for is the real client; falls back to 'local' for
 * direct/dev requests. This is a security-relevant trust decision (XFF is
 * client-spoofable, and it keys the limiter), so it lives in ONE place —
 * every rate-limited surface (guest funnel, /read/search) must call this
 * rather than re-inlining the split.
 */
export function clientIpFrom(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

/** Test hook. */
export function resetIpRateLimiter(): void {
  windows.clear();
}
