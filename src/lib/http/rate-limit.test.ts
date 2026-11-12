import { beforeEach, describe, expect, it } from 'vitest';

import { consumeRateLimit, getClientAddress, RATE_LIMIT_MAX_REQUESTS, resetRateLimit } from '@/lib/http/rate-limit';

beforeEach(() => {
  resetRateLimit();
});

describe('consumeRateLimit', () => {
  it('blocks a key after the window budget and allows it again in the next window', () => {
    const start = 1_000_000;
    for (let index = 0; index < RATE_LIMIT_MAX_REQUESTS; index += 1) {
      expect(consumeRateLimit('client', start)).toBe(true);
    }

    expect(consumeRateLimit('client', start + 59_999)).toBe(false);
    expect(consumeRateLimit('client', start + 60_000)).toBe(true);
  });
});

describe('getClientAddress', () => {
  it('uses the first x-forwarded-for entry', () => {
    const request = new Request('http://localhost/', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });

    expect(getClientAddress(request)).toBe('203.0.113.7');
  });
});
