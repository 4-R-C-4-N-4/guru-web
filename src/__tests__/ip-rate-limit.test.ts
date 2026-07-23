/**
 * src/__tests__/ip-rate-limit.test.ts
 *
 * The in-memory fixed-window limiter guarding public surfaces
 * (todo:3c342f3b). Distinct keys are independent; the window refills after
 * expiry; verdicts report a sane retry-after.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ipRateLimit, resetIpRateLimiter } from '@/lib/ip-rate-limit';

beforeEach(() => {
  resetIpRateLimiter();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('ipRateLimit', () => {
  it('allows up to the limit within a window, then blocks with retry-after', () => {
    for (let i = 0; i < 3; i++) {
      expect(ipRateLimit('search:1.2.3.4', 3, 60_000).allowed).toBe(true);
    }
    const v = ipRateLimit('search:1.2.3.4', 3, 60_000);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSeconds).toBeGreaterThan(0);
    expect(v.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('keys are independent', () => {
    for (let i = 0; i < 3; i++) ipRateLimit('search:1.2.3.4', 3, 60_000);
    expect(ipRateLimit('search:5.6.7.8', 3, 60_000).allowed).toBe(true);
  });

  it('window refills after expiry', () => {
    for (let i = 0; i < 3; i++) ipRateLimit('search:1.2.3.4', 3, 60_000);
    expect(ipRateLimit('search:1.2.3.4', 3, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(ipRateLimit('search:1.2.3.4', 3, 60_000).allowed).toBe(true);
  });
});
