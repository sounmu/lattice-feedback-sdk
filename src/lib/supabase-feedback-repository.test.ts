import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedbackBody } from '@/app/api/feedback/feedback-test-fixtures';
import { FeedbackDuplicateTargetError } from '@/lib/feedback-duplicate-target-error';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { ConversationLimitError } from '@/lib/conversation';
import { createSupabaseFeedbackRepository } from '@/lib/supabase-feedback-repository';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';

interface ReceivedRequest {
  readonly method: string | undefined;
  readonly url: URL;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const input = createFeedbackInputSchema.parse(createFeedbackBody());
const storedRow = {
  id: '00000000-0000-4000-8000-000000000001',
  projectKey: input.projectKey,
  message: input.message,
  type: input.type,
  status: 'open',
  duplicateOfId: null,
  reporter: input.reporter,
  page: input.page,
  attachments: input.attachments,
  adminReply: null,
  createdAt: '2026-11-12T12:00:00+00:00',
  updatedAt: '2026-11-12T12:00:00+00:00',
};
const received: ReceivedRequest[] = [];
let responseBodies: string[] = [];
let responseStatus = 200;
let respondToRequest: ((request: ReceivedRequest) => unknown) | null = null;
let serverUrl = '';
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  const receivedRequest: ReceivedRequest = {
    method: request.method,
    url: new URL(request.url ?? '/', serverUrl),
    headers: request.headers,
    body,
  };
  received.push(receivedRequest);
  response.writeHead(responseStatus, { 'Content-Type': 'application/json' });
  response.end(respondToRequest ? JSON.stringify(respondToRequest(receivedRequest)) : responseBodies.shift() ?? '[]');
});

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP test server.');
  }
  serverUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  server.closeAllConnections();
  await once(server, 'close');
});

beforeEach(() => {
  received.length = 0;
  responseStatus = 200;
  responseBodies = [];
  respondToRequest = null;
  vi.stubEnv('SUPABASE_URL', serverUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_local-test-only');
});

afterEach(() => vi.unstubAllEnvs());

describe('Supabase REST repository contract', () => {
  it('distinguishes a full conversation from duplicate-target conflicts', async () => {
    responseStatus = 409;
    responseBodies = [JSON.stringify({ code: 'PT409' }), JSON.stringify({ code: '23503' })];
    const repository = createSupabaseFeedbackRepository();
    await expect(repository.update('demo', storedRow.id, { adminReply: 'full' })).rejects.toBeInstanceOf(ConversationLimitError);
    await expect(repository.update('demo', storedRow.id, { status: 'duplicate', duplicateOfId: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(FeedbackDuplicateTargetError);
  });
  it('uses the service-only credential RPC without trusting reporter metadata', async () => {
    responseBodies = ['[]', '[]'];
    const repository = createSupabaseFeedbackRepository();
    const credentials = { browserSecretHashes: ['a'.repeat(64)], verifiedReporterId: 'verified-alice' };

    expect(await repository.findMany('demo', credentials)).toEqual([]);
    expect(await repository.appendReporterMessage('other', storedRow.id, { credentials, body: 'followup' })).toBeNull();

    expect(received[0].url.pathname).toBe('/rest/v1/rpc/read_reporter_conversations');
    expect(JSON.parse(received[0].body)).toEqual({ p_project: 'demo', p_id: null, p_hashes: credentials.browserSecretHashes, p_reporter: 'verified-alice' });
    expect(JSON.parse(received[1].body)).toEqual({ p_project: 'other', p_id: storedRow.id, p_hashes: credentials.browserSecretHashes, p_reporter: 'verified-alice', p_body: 'followup' });
    expect(received[0].url.searchParams.get('select')).not.toContain('browser_secret_hash');
  });

  it('persists access hashes alongside creation and parses message roles', async () => {
    const messages = [{ id: 'legacy', authorRole: 'admin', body: 'Original answer', createdAt: storedRow.updatedAt }];
    responseBodies = [JSON.stringify([{ ...storedRow, messages }])];
    const access = { browserSecretHash: 'a'.repeat(64), verifiedReporterId: 'alice' };
    const result = await createSupabaseFeedbackRepository().create(input, undefined, access);
    expect(JSON.parse(received[0].body)).toMatchObject({ browser_secret_hash: access.browserSecretHash, verified_reporter_id: 'alice' });
    expect(result.messages).toEqual(messages);
    expect(result).not.toHaveProperty('browserSecretHash');
  });

  it('fails closed when the conversation RPC returns invalid storage data', async () => {
    responseBodies = [JSON.stringify([{ ...storedRow, messages: [{ authorRole: 'owner', body: 'bad' }] }])];
    await expect(createSupabaseFeedbackRepository().findMany('demo', { browserSecretHashes: [], verifiedReporterId: 'alice' }))
      .rejects.toEqual(new FeedbackStorageUnavailableError());
  });

  it('creates feedback with server-only authentication and no hostOrigin in storage', async () => {
    responseStatus = 201;
    responseBodies = [JSON.stringify([storedRow])];

    const feedback = await createSupabaseFeedbackRepository().create(input);

    expect(feedback).toMatchObject({ id: storedRow.id, status: 'open', adminReply: null });
    expect(received[0].headers.apikey).toBe('sb_secret_local-test-only');
    expect(received[0].headers.prefer).toBe('return=representation');
    expect(received[0].url.pathname).toBe('/rest/v1/feedback');
    expect(JSON.parse(received[0].body)).toEqual({
      project_key: 'demo',
      message: input.message,
      type: 'bug',
      reporter: input.reporter,
      page: input.page,
      attachments: { comments: [], edits: [], flow: null },
    });
  });

  it('continues through capped responses and requests a stable newest-first order', async () => {
    const first = { ...storedRow, id: '00000000-0000-4000-8000-000000000003' };
    const second = { ...storedRow, id: '00000000-0000-4000-8000-000000000002' };
    responseBodies = [JSON.stringify([first, second]), JSON.stringify([storedRow]), '[]'];

    const items = await createSupabaseFeedbackRepository().findMany('demo');

    expect(items.map((item) => item.id)).toEqual([first.id, second.id, storedRow.id]);
    expect(received.map((request) => request.url.searchParams.get('or'))).toEqual([
      null,
      `(created_at.lt.${second.createdAt},and(created_at.eq.${second.createdAt},id.lt.${second.id}))`,
      `(created_at.lt.${storedRow.createdAt},and(created_at.eq.${storedRow.createdAt},id.lt.${storedRow.id}))`,
    ]);
    for (const request of received) {
      expect(request.url.searchParams.get('project_key')).toBe('eq.demo');
      expect(request.url.searchParams.get('order')).toBe('created_at.desc,id.desc');
      expect(request.url.searchParams.get('limit')).toBe('100');
    }
  });

  it('does not duplicate rows when a new feedback arrives between pages', async () => {
    const originalRows = Array.from({ length: 101 }, (_, index) => ({
      ...storedRow,
      id: `00000000-0000-4000-8000-${String(101 - index).padStart(12, '0')}`,
    }));
    const databaseRows = [...originalRows];
    let pageRequests = 0;
    respondToRequest = ({ url }) => {
      const cursor = url.searchParams.get('or')?.match(/created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)/);
      const matchingRows = databaseRows.filter((row) => {
        if (!cursor) return true;
        return row.createdAt < cursor[1] || (row.createdAt === cursor[1] && row.id < cursor[2]);
      });
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const page = matchingRows.slice(offset, offset + Number(url.searchParams.get('limit')));
      if (pageRequests++ === 0) {
        databaseRows.unshift({
          ...storedRow,
          id: '00000000-0000-4000-8000-000000000999',
          createdAt: '2026-11-12T13:00:00+00:00',
        });
      }
      return page;
    };

    const items = await createSupabaseFeedbackRepository().findMany('demo');

    expect(items.map((item) => item.id)).toEqual(originalRows.map((row) => row.id));
  });

  it('scopes detail and update requests to the project even when the ID is known', async () => {
    const repository = createSupabaseFeedbackRepository();

    expect(await repository.find('other', storedRow.id)).toBeNull();
    expect(await repository.update('other', storedRow.id, { status: 'resolved' })).toBeNull();

    expect(received.map((request) => request.method)).toEqual(['GET', 'PATCH']);
    for (const request of received) {
      expect(request.url.searchParams.get('project_key')).toBe('eq.other');
      expect(request.url.searchParams.get('id')).toBe(`eq.${storedRow.id}`);
    }
  });

  it('updates only supplied fields, including clearing a reply', async () => {
    responseBodies = [JSON.stringify([storedRow])];

    await createSupabaseFeedbackRepository().update('demo', storedRow.id, { adminReply: null });

    expect(JSON.parse(received[0].body)).toEqual({
      admin_reply: null,
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('stores the original of a duplicate in its own column', async () => {
    const duplicateOfId = '00000000-0000-4000-8000-000000000002';
    responseBodies = [JSON.stringify([{ ...storedRow, status: 'duplicate', duplicateOfId }])];

    const feedback = await createSupabaseFeedbackRepository().update('demo', storedRow.id, { status: 'duplicate', duplicateOfId });

    expect(feedback).toMatchObject({ status: 'duplicate', duplicateOfId });
    expect(JSON.parse(received[0].body)).toMatchObject({ status: 'duplicate', duplicate_of: duplicateOfId });
    expect(received[0].url.searchParams.get('select')).toContain('duplicateOfId:duplicate_of');
  });

  it.each(['23503', '23514'])('reports a database refusal %s of the original as an invalid duplicate target, and only then', async (code) => {
    const duplicateOfId = '00000000-0000-4000-8000-000000000002';
    responseStatus = 400;
    responseBodies = [JSON.stringify({ code, message: 'private database error' }), JSON.stringify({ code, message: 'private database error' })];
    const repository = createSupabaseFeedbackRepository();

    await expect(repository.update('demo', storedRow.id, { status: 'duplicate', duplicateOfId }))
      .rejects.toEqual(new FeedbackDuplicateTargetError());
    await expect(repository.update('demo', storedRow.id, { adminReply: 'x' }))
      .rejects.toEqual(new FeedbackStorageUnavailableError());
  });

  it('treats a non-UUID identifier as missing without sending a failing SQL filter', async () => {
    const repository = createSupabaseFeedbackRepository();

    expect(await repository.find('demo', 'missing')).toBeNull();
    expect(await repository.update('demo', 'missing', { status: 'resolved' })).toBeNull();
    expect(received).toHaveLength(0);
  });

  it.each([
    { status: 403, body: '{"message":"private database error"}' },
    { status: 200, body: 'not json' },
    { status: 200, body: '[{"id":"unexpected-shape"}]' },
  ])('reports unavailable storage for HTTP $status and malformed/error data', async ({ status, body }) => {
    responseStatus = status;
    responseBodies = [body];

    await expect(createSupabaseFeedbackRepository().find('demo', storedRow.id))
      .rejects.toEqual(new FeedbackStorageUnavailableError());
  });
});

describe('repository selection', () => {
  it('selects Supabase in production and preserves its REST contract', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FEEDBACK_STORAGE', undefined);
    responseBodies = [JSON.stringify([storedRow])];

    const feedback = await getFeedbackRepository().create(input);

    expect(feedback.id).toBe(storedRow.id);
    expect(received).toHaveLength(1);
  });

  it.each(['missing-url', 'missing-secret', 'publishable-key', 'unknown-storage'])(
    'rejects %s instead of silently storing feedback in memory',
    (configuration) => {
      vi.stubEnv('FEEDBACK_STORAGE', 'supabase');
      if (configuration === 'missing-url') vi.stubEnv('SUPABASE_URL', undefined);
      if (configuration === 'missing-secret') vi.stubEnv('SUPABASE_SECRET_KEY', undefined);
      if (configuration === 'publishable-key') vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_publishable_invalid');
      if (configuration === 'unknown-storage') vi.stubEnv('FEEDBACK_STORAGE', 'typo');

      expect(() => getFeedbackRepository()).toThrow(FeedbackStorageUnavailableError);
    },
  );
});
