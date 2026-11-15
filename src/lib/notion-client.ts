import type { NotionConfig, NotionParent } from '@/lib/notion-config';
import type { TicketDraft } from '@/lib/ticket-draft';
import type { TicketErrorCode } from '@/types/ticket';

export type CreateNotionTicketResult = { ok: true; url: string } | { ok: false; code: TicketErrorCode };

const NOTION_PAGES_URL = 'https://api.notion.com/v1/pages';
// A board with one data source works with the older version; data_source_id needs the newer one.
const DATABASE_PARENT_VERSION = '2022-06-28';
const DATA_SOURCE_PARENT_VERSION = '2025-09-03';
const REQUEST_TIMEOUT_MS = 10_000;
// Notion rejects a text longer than 2000 characters and more than 100 blocks per request; stay below both.
const MAX_TEXT_LENGTH = 1900;
const MAX_BLOCK_COUNT = 95;
const TRUNCATION_MARK = '… (전체 내용은 관리자 화면에서 확인)';

function limitText(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_TEXT_LENGTH - TRUNCATION_MARK.length)}${TRUNCATION_MARK}`;
}

function createRichText(text: string) {
  return [{ type: 'text', text: { content: limitText(text) } }];
}

type NotionBlock = Record<string, unknown>;

function createBlocks(draft: TicketDraft): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  for (const section of draft.sections) {
    blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: createRichText(section.heading) } });
    for (const line of section.lines) {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: createRichText(line) } });
    }
  }
  if (blocks.length <= MAX_BLOCK_COUNT) {
    return blocks;
  }
  const kept = blocks.slice(0, MAX_BLOCK_COUNT);
  kept.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: createRichText('… 내용이 길어 일부만 옮겼어요.') } });
  return kept;
}

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
  draft: TicketDraft,
  fetchImplementation: typeof fetch = fetch,
): Promise<CreateNotionTicketResult> {
  const body = {
    parent: createParent(config.parent),
    properties: { [config.titleProperty]: { title: createRichText(draft.title) } },
    children: createBlocks(draft),
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
