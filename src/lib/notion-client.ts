import type { NotionConfig, NotionParent } from '@/lib/notion-config';
import { convertMarkdownToNotionBlocks, createNotionTitle } from '@/lib/markdown-to-notion-blocks';
import type { TicketContent, TicketErrorCode } from '@/types/ticket';

export type CreateNotionTicketResult = { ok: true; url: string } | { ok: false; code: TicketErrorCode };

const NOTION_PAGES_URL = 'https://api.notion.com/v1/pages';
// A board with one data source works with the older version; data_source_id needs the newer one.
const DATABASE_PARENT_VERSION = '2022-06-28';
const DATA_SOURCE_PARENT_VERSION = '2025-09-03';
const REQUEST_TIMEOUT_MS = 10_000;

function createParent(parent: NotionParent) {
  if (parent.kind === 'data_source') {
    return { type: 'data_source_id', data_source_id: parent.id };
  }
  return { type: 'database_id', database_id: parent.id };
}

function findNotionVersion(parent: NotionParent): string {
  return parent.kind === 'data_source' ? DATA_SOURCE_PARENT_VERSION : DATABASE_PARENT_VERSION;
}

function findErrorCode(status: number): TicketErrorCode {
  if (status === 401) {
    return 'ticket_not_configured';
  }
  if (status === 404) {
    return 'ticket_target_not_shared';
  }
  if (status === 400) {
    return 'ticket_target_invalid';
  }
  if (status === 429) {
    return 'ticket_rate_limited';
  }
  return 'ticket_failed';
}

function isPageResponse(value: unknown): value is { url: string } {
  return typeof value === 'object' && value !== null && typeof (value as { url?: unknown }).url === 'string';
}

export async function createNotionTicket(
  config: NotionConfig,
  ticket: TicketContent,
  fetchImplementation: typeof fetch = fetch,
): Promise<CreateNotionTicketResult> {
  const body = {
    parent: createParent(config.parent),
    properties: { [config.titleProperty]: { title: createNotionTitle(ticket.title) } },
    children: convertMarkdownToNotionBlocks(ticket.body),
  };

  let response: Response;
  try {
    response = await fetchImplementation(NOTION_PAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'Notion-Version': findNotionVersion(config.parent),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, code: 'ticket_failed' };
  }

  if (!response.ok) {
    return { ok: false, code: findErrorCode(response.status) };
  }
  const page: unknown = await response.json().catch(() => null);
  if (!isPageResponse(page)) {
    return { ok: false, code: 'ticket_failed' };
  }
  return { ok: true, url: page.url };
}
