import { beforeEach, describe, expect, it } from 'vitest';

import { isSameOriginRequest } from '@/lib/http/request-origin';

// request.url as Next builds it internally; it differs from the public address the browser used.
const INTERNAL_URL = 'http://localhost:3504/api/feedback';

function createRequest(headers: Record<string, string>) {
  return new Request(INTERNAL_URL, { method: 'POST', headers });
}

beforeEach(() => {
  delete process.env.FEEDBACK_APP_ORIGINS;
});

describe('isSameOriginRequest', () => {
  it('accepts Sec-Fetch-Site same-origin even when Origin differs from the internal URL', () => {
    const request = createRequest({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:4505' });

    expect(isSameOriginRequest(request)).toBe(true);
  });

  it('rejects cross-site requests even if they claim a configured Origin', () => {
    process.env.FEEDBACK_APP_ORIGINS = 'https://feedback.example.com';
    const request = createRequest({ 'sec-fetch-site': 'cross-site', origin: 'https://feedback.example.com' });

    expect(isSameOriginRequest(request)).toBe(false);
  });

  it('falls back to the configured public origins when Sec-Fetch-Site is absent', () => {
    process.env.FEEDBACK_APP_ORIGINS = 'http://127.0.0.1:3504, https://feedback.example.com';

    expect(isSameOriginRequest(createRequest({ origin: 'http://127.0.0.1:3504' }))).toBe(true);
    expect(isSameOriginRequest(createRequest({ origin: 'https://evil.example.com' }))).toBe(false);
  });

  it('rejects requests with neither header', () => {
    expect(isSameOriginRequest(createRequest({}))).toBe(false);
  });
});
