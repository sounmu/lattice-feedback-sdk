import { describe, expect, it, vi } from 'vitest';

import { createNotionTicket } from '@/lib/notion-client';
import type { NotionConfig } from '@/lib/notion-config';
import { MAX_TICKET_TITLE_LENGTH } from '@/lib/ticket-limits';
import type { TicketContent } from '@/types/ticket';

const DRAFT: TicketContent = {
  title: '[버그] 엑셀 다운로드',
  body: '## 요약\n\n- 유형: 버그\n\n## 사용자 진술\n\n> 버튼이 안 눌려요',
};
const DATABASE_CONFIG: NotionConfig = { token: 'secret', parent: { kind: 'database', id: 'db-1' }, titleProperty: 'Name' };
// Notion rejects a request over 500KB: https://developers.notion.com/reference/request-limits
const NOTION_MAX_REQUEST_BYTES = 500_000;

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

  it('writes the Markdown body as Notion blocks', async () => {
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });

    await createNotionTicket(DATABASE_CONFIG, DRAFT, fetchMock);

    const types = readRequest(fetchMock).body.children.map((block: { type: string }) => block.type);
    expect(types).toEqual(['heading_2', 'bulleted_list_item', 'heading_2', 'quote']);
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

  it('shortens a title that is too long for Notion', async () => {
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });

    await createNotionTicket(DATABASE_CONFIG, { title: '가'.repeat(5000), body: '' }, fetchMock);

    const content = readRequest(fetchMock).body.properties.Name.title[0].text.content as string;
    expect(content.length).toBeLessThanOrEqual(2000);
  });

  it('keeps the request within the Notion size limit when the draft is too large to send whole', async () => {
    // Each paragraph is within the limit for one block, yet 95 of them are about 550KB of Korean text.
    const body = Array.from({ length: 95 }, () => '가'.repeat(1900)).join('\n\n');
    const fetchMock = createFetchMock({ url: 'https://www.notion.so/ticket-1' });

    await createNotionTicket(DATABASE_CONFIG, { title: '가'.repeat(MAX_TICKET_TITLE_LENGTH), body }, fetchMock);

    const sentBytes = new TextEncoder().encode(String(readRequest(fetchMock).init.body)).length;
    expect(sentBytes).toBeLessThanOrEqual(NOTION_MAX_REQUEST_BYTES);
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
