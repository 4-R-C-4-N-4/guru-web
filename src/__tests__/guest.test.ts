/**
 * src/__tests__/guest.test.ts
 *
 * Guest entitlement primitive (todo:6e5d50fa): signed-token mint/verify,
 * the two-layer one-shot + IP gate, and the stable ip-name pseudonym.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetIpRateLimiter } from '@/lib/ip-rate-limit';
import {
  mintGuestToken,
  verifyGuestToken,
  consumeGuestQuery,
  ipName,
  clientIpFrom,
  FREE_GUEST_QUERIES,
} from '@/lib/guest';

beforeEach(() => resetIpRateLimiter());

describe('guest token sign/verify', () => {
  it('round-trips a freshly minted token to a stable id', () => {
    const token = mintGuestToken();
    const id = verifyGuestToken(token);
    expect(id).toBeTruthy();
    expect(verifyGuestToken(token)).toBe(id); // deterministic
  });

  it('rejects absent, malformed, and tampered tokens', () => {
    expect(verifyGuestToken(null)).toBeNull();
    expect(verifyGuestToken('')).toBeNull();
    expect(verifyGuestToken('no-dot')).toBeNull();
    expect(verifyGuestToken('id.')).toBeNull();
    const token = mintGuestToken();
    const [id] = token.split('.');
    expect(verifyGuestToken(`${id}.deadbeef`)).toBeNull();        // wrong sig
    expect(verifyGuestToken(`${id}x.${token.split('.')[1]}`)).toBeNull(); // mutated id
  });
});

describe('consumeGuestQuery gate', () => {
  it('grants exactly FREE_GUEST_QUERIES per token, then denies with reason=token', () => {
    const id = 'tok_a';
    for (let i = 0; i < FREE_GUEST_QUERIES; i++) {
      expect(consumeGuestQuery(id, '1.1.1.1').allowed).toBe(true);
    }
    const denied = consumeGuestQuery(id, '1.1.1.1');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('token');
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('IP layer backstops cookie-clearing: fresh token each time, same IP', () => {
    const ip = '9.9.9.9';
    let allowed = 0;
    for (let i = 0; i < 20; i++) {
      // A new (unforgeable-in-prod, but here arbitrary) id each call models
      // a visitor clearing the cookie to dodge the one-shot token cap.
      if (consumeGuestQuery(`fresh_${i}`, ip).allowed) allowed++;
    }
    // Token layer never trips (every id is new); the IP layer caps the total.
    expect(allowed).toBeGreaterThan(0);
    expect(allowed).toBeLessThan(20);
    const v = consumeGuestQuery('fresh_last', ip);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('ip');
  });

  it('a spent token does not consume IP budget (token checked first)', () => {
    const ip = '2.2.2.2';
    consumeGuestQuery('tok_b', ip);          // spends the one token question
    consumeGuestQuery('tok_b', ip);          // denied at token layer
    // A different fresh token from the same IP should still be allowed —
    // the denied calls above must not have burned IP budget.
    expect(consumeGuestQuery('tok_c', ip).allowed).toBe(true);
  });
});

describe('ipName', () => {
  it('is deterministic and shaped adjective-creature', () => {
    const a = ipName('203.0.113.7');
    expect(a).toBe(ipName('203.0.113.7'));
    expect(a).toMatch(/^[a-z]+-[a-z]+$/);
  });
  it('varies across IPs', () => {
    // Not a strict guarantee, but the wordlist space makes collision unlikely.
    const names = new Set(['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'].map(ipName));
    expect(names.size).toBeGreaterThan(1);
  });
});

describe('clientIpFrom', () => {
  it('takes the first x-forwarded-for hop', () => {
    const h = new Headers({ 'x-forwarded-for': '5.5.5.5, 10.0.0.1' });
    expect(clientIpFrom(h)).toBe('5.5.5.5');
  });
  it('falls back to local when the header is absent', () => {
    expect(clientIpFrom(new Headers())).toBe('local');
  });
});
