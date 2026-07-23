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

/** Test hook. */
export function resetIpRateLimiter(): void {
  windows.clear();
}
