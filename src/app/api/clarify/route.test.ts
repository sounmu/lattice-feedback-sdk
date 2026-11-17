import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/clarify/route';
import { ALLOWED_ORIGIN, createJsonRequest } from '@/app/api/feedback/feedback-test-fixtures';
import { resetRateLimit } from '@/lib/http/rate-limit';
import type { ApiErrorResponse, ClarifyResponse } from '@/types/feedback';

const URL_ = 'http://localhost:3000/api/clarify';
const BODY = { projectKey: 'demo', hostOrigin: ALLOWED_ORIGIN, message: '저장이 안 돼요', type: 'bug', page: { url: `${ALLOWED_ORIGIN}/orders` } };
const QUESTION = { question: '저장 뒤 어떤 일이 있었나요?', options: ['오류가 떴어요', '아무 반응이 없었어요'] };

function stubModel(response: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => response());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  delete process.env.FEEDBACK_ALLOWED_ORIGINS;
  resetRateLimit();
  process.env.FEEDBACK_AI_BASE_URL = 'http://localhost:11434/v1';
  process.env.FEEDBACK_AI_MODEL = 'deepseek-v4.1-flash';
});

afterEach(() => {
  delete process.env.FEEDBACK_AI_BASE_URL;
  delete process.env.FEEDBACK_AI_MODEL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/clarify', () => {
  it('returns the model questions with the model name', async () => {
    stubModel(() => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions: [QUESTION] }) } }] })));
    const response = await POST(createJsonRequest(URL_, 'POST', BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questions: [QUESTION], model: 'deepseek-v4.1-flash' } satisfies ClarifyResponse);
  });

  it('answers with no questions when no model is configured, without calling one', async () => {
    delete process.env.FEEDBACK_AI_BASE_URL;
    const fetchMock = stubModel(() => new Response('{}'));
    const response = await POST(createJsonRequest(URL_, 'POST', BODY));

    expect(await response.json()).toEqual({ questions: [], model: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers with no questions when the model fails, and logs only the reason', async () => {
    stubModel(() => new Response('down', { status: 503 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST(createJsonRequest(URL_, 'POST', BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questions: [], model: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(BODY.message);
  });

  it('refuses requests from another site, unknown origins and invalid bodies', async () => {
    const fetchMock = stubModel(() => new Response('{}'));
    const crossSite = await POST(createJsonRequest(URL_, 'POST', BODY, { 'sec-fetch-site': 'cross-site' }));
    const otherOrigin = await POST(createJsonRequest(URL_, 'POST', { ...BODY, hostOrigin: 'https://evil.example.com' }));
    const invalid = await POST(createJsonRequest(URL_, 'POST', { ...BODY, message: ' ' }));

    expect(crossSite.status).toBe(403);
    expect(((await otherOrigin.json()) as ApiErrorResponse).error.code).toBe('origin_not_allowed');
    expect(invalid.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
