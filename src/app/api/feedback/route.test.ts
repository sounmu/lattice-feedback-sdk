import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/feedback/route';
import {
  ADMIN_AUTHORIZATION,
  createFeedbackBody,
  createJsonRequest,
} from '@/app/api/feedback/feedback-test-fixtures';
import { RATE_LIMIT_MAX_REQUESTS, resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import type { ApiErrorResponse, CreateFeedbackResponse, FeedbackListResponse } from '@/types/feedback';

const COLLECTION_URL = 'http://localhost:3000/api/feedback';
const APP_ORIGIN = 'http://localhost:3000';
const LIST_URL = `${COLLECTION_URL}?projectKey=demo`;

beforeEach(() => {
  delete process.env.FEEDBACK_ALLOWED_ORIGINS;
  delete process.env.FEEDBACK_ADMIN_TOKEN;
  resetMemoryFeedbackStore();
  resetRateLimit();
});

describe('POST /api/feedback', () => {
  it('returns 201 for an allowed origin and does not store hostOrigin', async () => {
    const response = await POST(createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody()));
    const body = (await response.json()) as CreateFeedbackResponse;

    expect(response.status).toBe(201);
    expect(body.feedback.status).toBe('open');
    expect(body.feedback.adminReply).toBeNull();
    expect(body.feedback.projectKey).toBe('demo');
    expect(body.feedback).not.toHaveProperty('hostOrigin');
  });

  it('returns 403 origin_not_allowed for a disallowed origin', async () => {
    const request = createJsonRequest(
      COLLECTION_URL,
      'POST',
      createFeedbackBody({ hostOrigin: 'https://evil.example.com' }),
    );
    const response = await POST(request);
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('origin_not_allowed');
  });

  it('returns 403 cross_origin_request when another site posts an allowed hostOrigin', async () => {
    const request = createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody(), {
      origin: 'https://evil.example.com',
    });
    const response = await POST(request);
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('cross_origin_request');
  });

  it('returns 403 cross_origin_request when the allowed host page itself posts directly', async () => {
    const request = createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody(), {
      origin: 'http://localhost:4000',
    });
    const response = await POST(request);

    expect(response.status).toBe(403);
  });

  it('returns 403 cross_origin_request without Origin or Sec-Fetch-Site', async () => {
    const request = new Request(COLLECTION_URL, { method: 'POST', body: JSON.stringify(createFeedbackBody()) });
    const response = await POST(request);

    expect(response.status).toBe(403);
  });

  it('accepts Sec-Fetch-Site same-origin when Origin is absent', async () => {
    const request = new Request(COLLECTION_URL, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify(createFeedbackBody()),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('returns 429 with Retry-After once a client exceeds the rate limit', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.7' };
    for (let index = 0; index < RATE_LIMIT_MAX_REQUESTS; index += 1) {
      const accepted = await POST(createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody(), headers));
      expect(accepted.status).toBe(201);
    }
    const limited = await POST(createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody(), headers));
    const otherClient = await POST(
      createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody(), { 'x-forwarded-for': '203.0.113.8' }),
    );

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(otherClient.status).toBe(201);
  });

  it('returns 404 project_not_found for an unknown project', async () => {
    const response = await POST(createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody({ projectKey: 'nope' })));
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('project_not_found');
  });

  it('returns 400 invalid_body without echoing the payload', async () => {
    const response = await POST(
      createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody({ message: '', type: 'secret-type-value' })),
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text).error.code).toBe('invalid_body');
    expect(text).not.toContain('secret-type-value');
  });

  it('returns 400 invalid_json for a malformed body', async () => {
    const request = new Request(COLLECTION_URL, { method: 'POST', headers: { origin: APP_ORIGIN }, body: '{not json' });
    const response = await POST(request);
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('invalid_json');
  });

  it('returns 413 when content-length exceeds the limit', async () => {
    const request = createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody(), { 'content-length': '65537' });
    const response = await POST(request);

    expect(response.status).toBe(413);
  });

  it('returns 413 when the actual body exceeds the limit without a content-length header', async () => {
    const request = new Request(COLLECTION_URL, {
      method: 'POST',
      headers: { origin: APP_ORIGIN },
      body: 'x'.repeat(65537),
    });
    const response = await POST(request);

    expect(response.status).toBe(413);
  });
});

describe('GET /api/feedback', () => {
  it('returns 401 without a token', async () => {
    const response = await GET(new Request(LIST_URL));
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 with a wrong token', async () => {
    const response = await GET(new Request(LIST_URL, { headers: { authorization: 'Bearer wrong-token' } }));

    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown project', async () => {
    const url = `${COLLECTION_URL}?projectKey=nope`;
    const response = await GET(new Request(url, { headers: { authorization: ADMIN_AUTHORIZATION } }));

    expect(response.status).toBe(404);
  });

  it('returns 200 with the created item for the admin token, newest first', async () => {
    await POST(createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody({ message: 'first' })));
    const created = (await (
      await POST(createJsonRequest(COLLECTION_URL, 'POST', createFeedbackBody({ message: 'second' })))
    ).json()) as CreateFeedbackResponse;

    const response = await GET(new Request(LIST_URL, { headers: { authorization: ADMIN_AUTHORIZATION } }));
    const body = (await response.json()) as FeedbackListResponse;

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe(created.feedback.id);
    expect(body.items[0].message).toBe('second');
  });
});
