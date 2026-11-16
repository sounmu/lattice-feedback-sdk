import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTicket, getFeedbackDetail, getFeedbackList, updateFeedback } from '@/lib/admin-api';
import { MOCK_FEEDBACKS } from '@/mocks/feedback';

function mockFetchResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getFeedbackList', () => {
  it('sends the project key and bearer token, and returns the items', async () => {
    const fetchMock = mockFetchResponse({ items: MOCK_FEEDBACKS });

    const result = await getFeedbackList({ projectKey: 'demo', token: 'secret' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/feedback?projectKey=demo',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer secret' } }),
    );
    expect(result).toEqual({ ok: true, data: { items: MOCK_FEEDBACKS } });
  });

  it('encodes the project key', async () => {
    const fetchMock = mockFetchResponse({ items: [] });

    await getFeedbackList({ projectKey: 'a b&c', token: 'secret' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/feedback?projectKey=a%20b%26c');
  });

  it('maps a 401 response to the token message', async () => {
    mockFetchResponse({ error: { code: 'unauthorized', message: 'Admin authorization is required.' } }, 401);

    const result = await getFeedbackList({ projectKey: 'demo', token: 'wrong' });

    expect(result).toEqual({ ok: false, status: 401, message: '관리자 토큰이 올바르지 않아요.' });
  });

  it('reports a network failure with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await getFeedbackList({ projectKey: 'demo', token: 'secret' });

    expect(result).toMatchObject({ ok: false, status: 0 });
  });

  it('rejects a body that is not a feedback list', async () => {
    mockFetchResponse({ items: 'nope' });

    const result = await getFeedbackList({ projectKey: 'demo', token: 'secret' });

    expect(result).toMatchObject({ ok: false, status: 502 });
  });

  it('uses a fallback message for statuses it does not know', async () => {
    mockFetchResponse({}, 500);

    const result = await getFeedbackList({ projectKey: 'demo', token: 'secret' });

    expect(result).toMatchObject({ ok: false, status: 500, message: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  });
});

describe('getFeedbackDetail', () => {
  it('requests the encoded feedback id', async () => {
    const fetchMock = mockFetchResponse({ feedback: MOCK_FEEDBACKS[0], screenSnapshots: [] });

    const result = await getFeedbackDetail({ projectKey: 'demo', token: 'secret', id: 'fb/0001' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/feedback/fb%2F0001?projectKey=demo');
    expect(result.ok).toBe(true);
  });

  it('rejects a detail without saved screens', async () => {
    mockFetchResponse({ feedback: MOCK_FEEDBACKS[0] });

    const result = await getFeedbackDetail({ projectKey: 'demo', token: 'secret', id: 'fb_0001' });

    expect(result).toMatchObject({ ok: false, status: 502 });
  });
});

describe('updateFeedback', () => {
  it('sends the changes as a JSON PATCH', async () => {
    const fetchMock = mockFetchResponse({ feedback: MOCK_FEEDBACKS[0], screenSnapshots: [] });

    await updateFeedback({ projectKey: 'demo', token: 'secret', id: 'fb_0001', changes: { status: 'resolved', adminReply: '수정했어요.' } });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/feedback/fb_0001?projectKey=demo',
      expect.objectContaining({
        method: 'PATCH',
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', adminReply: '수정했어요.' }),
      }),
    );
  });

  it('maps a 404 response to the not-found message', async () => {
    mockFetchResponse({ error: { code: 'feedback_not_found', message: 'Feedback not found.' } }, 404);

    const result = await updateFeedback({ projectKey: 'demo', token: 'secret', id: 'missing', changes: { status: 'open' } });

    expect(result).toEqual({ ok: false, status: 404, message: '피드백을 찾을 수 없어요.' });
  });
});

const TICKET = { title: '[버그] 제목', body: '## 요약' };
describe('createTicket', () => {
  it('posts to the ticket endpoint and returns the link', async () => {
    const fetchMock = mockFetchResponse({ ticket: { url: 'https://www.notion.so/ticket-1' } }, 201);

    const result = await createTicket({ projectKey: 'demo', token: 'secret', id: 'fb_0001', ticket: TICKET });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/feedback/fb_0001/ticket?projectKey=demo',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' }, body: JSON.stringify(TICKET) }),
    );
    expect(result).toEqual({ ok: true, data: { ticket: { url: 'https://www.notion.so/ticket-1' } } });
  });

  it('explains a board that is not shared, using the error code', async () => {
    mockFetchResponse({ error: { code: 'ticket_target_not_shared', message: 'x' } }, 502);

    const result = await createTicket({ projectKey: 'demo', token: 'secret', id: 'fb_0001', ticket: TICKET });

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(result.ok === false && result.message).toContain('노션 보드를 찾을 수 없어요');
  });

  it('falls back to the status message for an unknown error code', async () => {
    mockFetchResponse({ error: { code: 'something_else', message: 'x' } }, 401);

    const result = await createTicket({ projectKey: 'demo', token: 'wrong', id: 'fb_0001', ticket: TICKET });

    expect(result).toEqual({ ok: false, status: 401, message: '관리자 토큰이 올바르지 않아요.' });
  });

  it('rejects a response without a link', async () => {
    mockFetchResponse({ ticket: {} }, 201);

    const result = await createTicket({ projectKey: 'demo', token: 'secret', id: 'fb_0001', ticket: TICKET });

    expect(result).toMatchObject({ ok: false, status: 502 });
  });
});
