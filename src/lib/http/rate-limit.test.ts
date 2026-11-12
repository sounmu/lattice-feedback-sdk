import { beforeEach, describe, expect, it } from 'vitest';

import {
  consumeRateLimit,
  getClientAddress,
  getTrackedClientCount,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_MAX_TRACKED_CLIENTS,
  resetRateLimit,
} from '@/lib/http/rate-limit';

beforeEach(() => {
  resetRateLimit();
  delete process.env.FEEDBACK_CLIENT_IP_HEADER;
  delete process.env.VERCEL;
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

  it('never tracks more than the client cap within one window', () => {
    const now = 1_000_000;
    for (let index = 0; index <= RATE_LIMIT_MAX_TRACKED_CLIENTS; index += 1) {
      consumeRateLimit(`client-${index}`, now);
    }

    expect(getTrackedClientCount()).toBe(RATE_LIMIT_MAX_TRACKED_CLIENTS);
  });

  it('evicts the least recently used key, not an active one', () => {
    const now = 1_000_000;
    for (let index = 0; index < RATE_LIMIT_MAX_TRACKED_CLIENTS; index += 1) {
      consumeRateLimit(`client-${index}`, now);
    }
    for (let index = 1; index < RATE_LIMIT_MAX_REQUESTS; index += 1) {
      consumeRateLimit('client-0', now);
    }

    consumeRateLimit('newcomer', now);

    // client-0 was touched last, so client-1 was evicted and client-0 keeps its exhausted budget.
    expect(consumeRateLimit('client-0', now)).toBe(false);
  });
});

describe('getClientAddress', () => {
  const spoofedRequest = new Request('http://localhost/', {
    headers: { 'x-forwarded-for': '203.0.113.7', 'x-vercel-forwarded-for': '198.51.100.1', 'x-real-ip': '192.0.2.5' },
  });

  it('ignores client-controlled headers when no trusted header is configured', () => {
    expect(getClientAddress(spoofedRequest)).toBe('unknown');
  });

  it('uses the platform header on Vercel', () => {
    process.env.VERCEL = '1';

    expect(getClientAddress(spoofedRequest)).toBe('198.51.100.1');
  });

  it('uses the configured proxy header', () => {
    process.env.FEEDBACK_CLIENT_IP_HEADER = 'X-Real-IP';

    expect(getClientAddress(spoofedRequest)).toBe('192.0.2.5');
  });
});
