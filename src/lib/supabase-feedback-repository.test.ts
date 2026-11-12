import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeedbackBody } from '@/app/api/feedback/feedback-test-fixtures';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
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
let serverUrl = '';
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  received.push({
    method: request.method,
    url: new URL(request.url ?? '/', serverUrl),
    headers: request.headers,
    body,
  });
  response.writeHead(responseStatus, { 'Content-Type': 'application/json' });
  response.end(responseBodies.shift() ?? '[]');
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
  vi.stubEnv('SUPABASE_URL', serverUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_local-test-only');
});

afterEach(() => vi.unstubAllEnvs());

describe('Supabase REST repository contract', () => {
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
    const second = { ...storedRow, id: '00000000-0000-4000-8000-000000000002' };
    const third = { ...storedRow, id: '00000000-0000-4000-8000-000000000003' };
    responseBodies = [JSON.stringify([storedRow, second]), JSON.stringify([third]), '[]'];

    const items = await createSupabaseFeedbackRepository().findMany('demo');

    expect(items.map((item) => item.id)).toEqual([storedRow.id, second.id, third.id]);
    expect(received.map((request) => request.url.searchParams.get('offset'))).toEqual(['0', '2', '3']);
    for (const request of received) {
      expect(request.url.searchParams.get('project_key')).toBe('eq.demo');
      expect(request.url.searchParams.get('order')).toBe('created_at.desc,id.desc');
      expect(request.url.searchParams.get('limit')).toBe('100');
    }
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
