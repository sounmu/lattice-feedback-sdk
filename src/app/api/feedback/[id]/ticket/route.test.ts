import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createTicket } from '@/app/api/feedback/[id]/ticket/route';
import { ADMIN_AUTHORIZATION, createFeedbackBody, createJsonRequest } from '@/app/api/feedback/feedback-test-fixtures';
import { POST as createFeedback } from '@/app/api/feedback/route';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import { MAX_TICKET_BODY_LENGTH, MAX_TICKET_REQUEST_BYTES, MAX_TICKET_TITLE_LENGTH, TICKET_CLAIM_TTL_MS } from '@/lib/ticket-limits';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import type { ApiErrorResponse, CreateFeedbackResponse } from '@/types/feedback';
import type { CreateTicketResponse } from '@/types/ticket';

const FEEDBACK_URL = 'http://localhost:4000/api/feedback';

function createContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const TICKET_CONTENT = { title: '[버그] 버튼이 안 눌려요', body: '## 요약\n\n- 유형: 버그' };

function createTicketRequest(id: string, headers: Record<string, string> = {}, projectKey = 'demo', content: unknown = TICKET_CONTENT) {
  return new Request(`http://localhost:3000/api/feedback/${id}/ticket?projectKey=${projectKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof content === 'string' ? content : JSON.stringify(content),
  });
}

async function createFeedbackId(): Promise<string> {
  const response = await createFeedback(createJsonRequest(FEEDBACK_URL, 'POST', createFeedbackBody()));
  return ((await response.json()) as CreateFeedbackResponse).feedback.id;
}

function stubNotion(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  delete process.env.FEEDBACK_ALLOWED_ORIGINS;
  delete process.env.FEEDBACK_ADMIN_TOKEN;
  process.env.NOTION_API_KEY = 'notion-secret';
  process.env.NOTION_DATABASE_ID = 'db-1';
  resetMemoryFeedbackStore();
  resetRateLimit();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NOTION_API_KEY;
  delete process.env.NOTION_DATABASE_ID;
  delete process.env.NOTION_DATA_SOURCE_ID;
});

describe('POST /api/feedback/[id]/ticket', () => {
  it('rejects a request without the admin token', async () => {
    const id = await createFeedbackId();
    const fetchMock = stubNotion({ url: 'https://www.notion.so/t' });

    const response = await createTicket(createTicketRequest(id), createContext(id));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown project', async () => {
    const response = await createTicket(createTicketRequest('x', { authorization: ADMIN_AUTHORIZATION }, 'other'), createContext('x'));

    expect(response.status).toBe(404);
  });

  it('returns 503 when Notion is not configured', async () => {
    delete process.env.NOTION_API_KEY;
    const id = await createFeedbackId();

    const response = await createTicket(createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }), createContext(id));

    expect(response.status).toBe(503);
    expect(((await response.json()) as ApiErrorResponse).error.code).toBe('ticket_not_configured');
  });

  it('returns 404 for an unknown feedback and does not call Notion', async () => {
    const fetchMock = stubNotion({ url: 'https://www.notion.so/t' });

    const response = await createTicket(createTicketRequest('missing', { authorization: ADMIN_AUTHORIZATION }), createContext('missing'));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates the ticket and returns its link', async () => {
    const id = await createFeedbackId();
    const fetchMock = stubNotion({ url: 'https://www.notion.so/ticket-1' });

    const response = await createTicket(createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }), createContext(id));

    expect(response.status).toBe(201);
    expect((await response.json()) as CreateTicketResponse).toEqual({ ticket: { url: 'https://www.notion.so/ticket-1' } });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.parent).toEqual({ type: 'database_id', database_id: 'db-1' });
    expect(body.properties.Name.title[0].text.content).toBe(TICKET_CONTENT.title);
    expect(body.children[0].type).toBe('heading_2');
  });

  it('rejects a body without a title and does not call Notion', async () => {
    const id = await createFeedbackId();
    const fetchMock = stubNotion({ url: 'https://www.notion.so/t' });

    const response = await createTicket(
      createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }, 'demo', { title: '  ', body: 'x' }),
      createContext(id),
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiErrorResponse).error.code).toBe('invalid_body');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON', async () => {
    const id = await createFeedbackId();

    const response = await createTicket(createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }, 'demo', 'not json'), createContext(id));

    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiErrorResponse).error.code).toBe('invalid_json');
  });

  it('rejects a body above the length limit as invalid, and one above the request limit as too large', async () => {
    const id = await createFeedbackId();
    const fetchMock = stubNotion({ url: 'https://www.notion.so/t' });

    const tooLong = await createTicket(
      createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }, 'demo', { title: 't', body: 'x'.repeat(MAX_TICKET_BODY_LENGTH + 1) }),
      createContext(id),
    );
    const tooLarge = await createTicket(
      createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }, 'demo', { title: 't', body: 'x'.repeat(MAX_TICKET_REQUEST_BYTES) }),
      createContext(id),
    );

    expect(tooLong.status).toBe(400);
    expect(tooLarge.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a title and body at their length limits, also in Korean where a character takes three bytes', async () => {
    const id = await createFeedbackId();
    stubNotion({ url: 'https://www.notion.so/t' });

    const response = await createTicket(
      createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }, 'demo', {
        title: '가'.repeat(MAX_TICKET_TITLE_LENGTH),
        body: '가'.repeat(MAX_TICKET_BODY_LENGTH),
      }),
      createContext(id),
    );

    expect(response.status).toBe(201);
  });

  it('never sends the Notion token back to the browser', async () => {
    const id = await createFeedbackId();
    stubNotion({ url: 'https://www.notion.so/ticket-1' });

    const response = await createTicket(createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }), createContext(id));

    expect(await response.text()).not.toContain('notion-secret');
  });

  it('reports a board that is not shared with the integration', async () => {
    const id = await createFeedbackId();
    stubNotion({ object: 'error' }, 404);

    const response = await createTicket(createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }), createContext(id));

    expect(response.status).toBe(502);
    expect(((await response.json()) as ApiErrorResponse).error.code).toBe('ticket_target_not_shared');
  });

  it('passes on a Notion rate limit as 429', async () => {
    const id = await createFeedbackId();
    stubNotion({ object: 'error' }, 429);

    const response = await createTicket(createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }), createContext(id));

    expect(response.status).toBe(429);
  });

  describe('making the ticket only once', () => {
    const NOTION_URL = 'https://www.notion.so/ticket-1';

    async function post(id: string) {
      return createTicket(createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }), createContext(id));
    }

    it('answers a second request with the saved link and does not call Notion again', async () => {
      const id = await createFeedbackId();
      const fetchMock = stubNotion({ url: NOTION_URL });

      const first = await post(id);
      const second = await post(id);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(((await second.json()) as CreateTicketResponse).ticket.url).toBe(NOTION_URL);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('makes one ticket for two requests at the same moment', async () => {
      const id = await createFeedbackId();
      const fetchMock = stubNotion({ url: NOTION_URL });

      const responses = await Promise.all([post(id), post(id)]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const conflict = responses.find((response) => response.status === 409);
      expect(((await conflict?.json()) as ApiErrorResponse).error.code).toBe('ticket_in_progress');
    });

    it('saves the link with the feedback, without changing when it was last updated', async () => {
      const id = await createFeedbackId();
      const before = await getFeedbackRepository().find('demo', id);
      stubNotion({ url: NOTION_URL });

      await post(id);

      const after = await getFeedbackRepository().find('demo', id);
      expect(after?.ticketUrl).toBe(NOTION_URL);
      expect(after?.updatedAt).toBe(before?.updatedAt);
    });

    it('lets the administrator try again at once after a refusal that made no page', async () => {
      const id = await createFeedbackId();
      stubNotion({ object: 'error' }, 404);
      expect((await post(id)).status).toBe(502);

      const fetchMock = stubNotion({ url: NOTION_URL });
      const retry = await post(id);

      expect(retry.status).toBe(201);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('holds back a retry after an unclear failure, because the page may exist, until the claim lapses', async () => {
      vi.useFakeTimers();
      try {
        const id = await createFeedbackId();
        stubNotion({ object: 'error' }, 500);
        expect((await post(id)).status).toBe(502);

        const fetchMock = stubNotion({ url: NOTION_URL });
        const early = await post(id);
        vi.advanceTimersByTime(TICKET_CLAIM_TTL_MS + 1);
        const late = await post(id);

        expect(early.status).toBe(409);
        expect(late.status).toBe(201);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still returns the link when saving it fails after the page was made', async () => {
      const id = await createFeedbackId();
      stubNotion({ url: NOTION_URL });
      const repository = getFeedbackRepository();
      vi.spyOn(repository, 'saveTicketUrl').mockRejectedValue(new FeedbackStorageUnavailableError());

      const response = await post(id);

      expect(response.status).toBe(201);
      expect(((await response.json()) as CreateTicketResponse).ticket.url).toBe(NOTION_URL);
    });

    it('does not make a ticket for a feedback of another project', async () => {
      const id = await createFeedbackId();
      const fetchMock = stubNotion({ url: NOTION_URL });

      const response = await createTicket(createTicketRequest(id, { authorization: ADMIN_AUTHORIZATION }, 'other'), createContext(id));

      expect(response.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
