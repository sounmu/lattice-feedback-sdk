import { describe, expect, it, vi } from 'vitest';

import { createNotionTicket } from '@/lib/notion-client';
import type { NotionConfig } from '@/lib/notion-config';
import type { TicketDraft } from '@/lib/ticket-draft';

const DRAFT: TicketDraft = {
  title: '[버그] 엑셀 다운로드',
  sections: [
    { heading: '요청 내용', lines: ['버튼이 안 눌려요'] },
    { heading: '정보', lines: ['유형: 버그'] },
  ],
};
const DATABASE_CONFIG: NotionConfig = { token: 'secret', parent: { kind: 'database', id: 'db-1' }, titleProperty: 'Name' };

function createFetchMock(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function readRequest(fetchMock: ReturnType<typeof createFetchMock>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> };
}

describe('createNotionTicket', () => {
  it('creates a page in the database and returns its link', async () => {
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });

    const result = await createNotionTicket(DATABASE_CONFIG, DRAFT, fetchMock);

    const request = readRequest(fetchMock);
    expect(result).toEqual({ ok: true, url: 'https://www.notion.so/ticket-1' });
    expect(request.url).toBe('https://api.notion.com/v1/pages');
    expect(request.init.method).toBe('POST');
    expect(request.headers.Authorization).toBe('Bearer secret');
    expect(request.headers['Notion-Version']).toBe('2022-06-28');
    expect(request.body.parent).toEqual({ type: 'database_id', database_id: 'db-1' });
    expect(request.body.properties).toEqual({ Name: { title: [{ type: 'text', text: { content: '[버그] 엑셀 다운로드' } }] } });
  });

  it('writes each section as a heading followed by its lines', async () => {
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });

    await createNotionTicket(DATABASE_CONFIG, DRAFT, fetchMock);

    const types = readRequest(fetchMock).body.children.map((block: { type: string }) => block.type);
    expect(types).toEqual(['heading_3', 'paragraph', 'heading_3', 'paragraph']);
  });

  it('uses the data source parent with the newer version', async () => {
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });

    await createNotionTicket({ ...DATABASE_CONFIG, parent: { kind: 'data_source', id: 'source-1' } }, DRAFT, fetchMock);

    const request = readRequest(fetchMock);
    expect(request.body.parent).toEqual({ type: 'data_source_id', data_source_id: 'source-1' });
    expect(request.headers['Notion-Version']).toBe('2025-09-03');
  });

  it('uses the configured title column name', async () => {
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });

    await createNotionTicket({ ...DATABASE_CONFIG, titleProperty: '이름' }, DRAFT, fetchMock);

    expect(Object.keys(readRequest(fetchMock).body.properties)).toEqual(['이름']);
  });

  it('shortens a text that is too long for Notion', async () => {
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });
    const draft: TicketDraft = { title: 'title', sections: [{ heading: '요청 내용', lines: ['가'.repeat(5000)] }] };

    await createNotionTicket(DATABASE_CONFIG, draft, fetchMock);

    const content = readRequest(fetchMock).body.children[1].paragraph.rich_text[0].text.content as string;
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain('전체 내용은 관리자 화면에서 확인');
  });

  it('keeps the block count under the Notion limit', async () => {
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });
    const draft: TicketDraft = {
      title: 'title',
      sections: [{ heading: '코멘트', lines: Array.from({ length: 300 }, (_, index) => `줄 ${index}`) }],
    };

    await createNotionTicket(DATABASE_CONFIG, draft, fetchMock);

    expect(readRequest(fetchMock).body.children.length).toBeLessThanOrEqual(100);
  });

  it.each([
    [401, 'ticket_not_configured'],
    [404, 'ticket_target_not_shared'],
    [400, 'ticket_target_invalid'],
    [429, 'ticket_rate_limited'],
    [500, 'ticket_failed'],
  ])('maps a %i response to %s', async (status, code) => {
    const result = await createNotionTicket(DATABASE_CONFIG, DRAFT, createFetchMock({ object: 'error' }, status));

    expect(result).toEqual({ ok: false, code });
  });

  it('fails when Notion cannot be reached', async () => {
    const result = await createNotionTicket(DATABASE_CONFIG, DRAFT, vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    expect(result).toEqual({ ok: false, code: 'ticket_failed' });
  });

  it('fails when the response has no page link', async () => {
    const result = await createNotionTicket(DATABASE_CONFIG, DRAFT, createFetchMock({ object: 'page' }));

    expect(result).toEqual({ ok: false, code: 'ticket_failed' });
  });
});
