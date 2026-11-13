import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { createSupabaseScreenSnapshotRepository } from '@/lib/supabase-screen-snapshot-repository';
import { createScreenSnapshotInputSchema } from '@/lib/validation/screen-snapshot-schema';

interface ReceivedRequest {
  readonly method: string | undefined;
  readonly url: URL;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const SNAPSHOT_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_SNAPSHOT_ID = '00000000-0000-4000-8000-0000000000a2';
const FEEDBACK_ID = '00000000-0000-4000-8000-0000000000f1';
const input = createScreenSnapshotInputSchema.parse(createScreenSnapshotBody());
const summaryRow = {
  id: SNAPSHOT_ID,
  projectKey: input.projectKey,
  feedbackId: null,
  createdAt: '2026-11-13T03:00:01+00:00',
  format: input.format,
  capturedAt: '2026-11-13T03:00:00+00:00',
  page: input.page,
  missingAssets: input.missingAssets,
  assetHashes: input.assetHashes,
};

const received: ReceivedRequest[] = [];
let responseBodies: unknown[] = [];
let responseStatus = 200;
let responseStatuses: number[] = [];
let serverUrl = '';
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  received.push({ method: request.method, url: new URL(request.url ?? '/', serverUrl), headers: request.headers, body });
  response.writeHead(responseStatuses.shift() ?? responseStatus, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(responseBodies.shift() ?? []));
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
  responseBodies = [];
  responseStatus = 200;
  responseStatuses = [];
  vi.stubEnv('SUPABASE_URL', serverUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_local-test-only');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function getSearch(request: ReceivedRequest): Record<string, string> {
  return Object.fromEntries(request.url.searchParams);
}

describe('Supabase saved screen repository', () => {
  it('stores a screen with the server key and answers with the summary only', async () => {
    responseBodies = [[summaryRow]];

    const snapshot = await createSupabaseScreenSnapshotRepository().create(input);

    const [request] = received;
    expect(request.method).toBe('POST');
    expect(request.url.pathname).toBe('/rest/v1/screen_snapshots');
    expect(request.headers.apikey).toBe('sb_secret_local-test-only');
    expect(getSearch(request).select).not.toContain('events');
    expect(JSON.parse(request.body)).toEqual({
      project_key: 'demo',
      format: 'rrweb-2',
      captured_at: input.capturedAt,
      page: input.page,
      events: input.events,
      missing_assets: [],
      asset_hashes: [],
    });
    expect(snapshot).toEqual(summaryRow);
  });

  it('reads the events only for one screen of the requested project', async () => {
    responseBodies = [[{ ...summaryRow, events: input.events }]];
    const repository = createSupabaseScreenSnapshotRepository();

    const snapshot = await repository.find('demo', SNAPSHOT_ID);

    expect(getSearch(received[0])).toMatchObject({ project_key: 'eq.demo', id: `eq.${SNAPSHOT_ID}` });
    expect(getSearch(received[0]).select).toContain('events');
    expect(snapshot?.events).toEqual(input.events);
    expect(await repository.find('demo', 'not-a-uuid')).toBeNull();
    expect(received).toHaveLength(1);
  });

  it('claims only unlinked screens of the project, and releases a partial claim', async () => {
    const repository = createSupabaseScreenSnapshotRepository();
    responseBodies = [[{ id: SNAPSHOT_ID }], [{ id: SNAPSHOT_ID }]];

    expect(await repository.claimForFeedback('demo', [SNAPSHOT_ID, OTHER_SNAPSHOT_ID], FEEDBACK_ID)).toBe(false);

    expect(received[0].method).toBe('PATCH');
    expect(getSearch(received[0])).toMatchObject({
      project_key: 'eq.demo',
      feedback_id: 'is.null',
      id: `in.(${SNAPSHOT_ID},${OTHER_SNAPSHOT_ID})`,
    });
    expect(JSON.parse(received[0].body)).toEqual({ feedback_id: FEEDBACK_ID });
    expect(received[1].method).toBe('PATCH');
    expect(getSearch(received[1])).toMatchObject({ project_key: 'eq.demo', feedback_id: `eq.${FEEDBACK_ID}` });
    expect(JSON.parse(received[1].body)).toEqual({ feedback_id: null });
  });

  it('undoes a claim whose request failed, because the update may have committed anyway', async () => {
    const repository = createSupabaseScreenSnapshotRepository();
    responseStatuses = [504, 200];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(repository.claimForFeedback('demo', [SNAPSHOT_ID], FEEDBACK_ID)).rejects.toBeInstanceOf(
      FeedbackStorageUnavailableError,
    );

    expect(received).toHaveLength(2);
    expect(getSearch(received[1])).toMatchObject({ project_key: 'eq.demo', feedback_id: `eq.${FEEDBACK_ID}` });
    expect(JSON.parse(received[1].body)).toEqual({ feedback_id: null });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('lists the screens of one feedback oldest first', async () => {
    responseBodies = [[{ ...summaryRow, feedbackId: FEEDBACK_ID }]];

    const snapshots = await createSupabaseScreenSnapshotRepository().findManyByFeedback('demo', FEEDBACK_ID);

    expect(getSearch(received[0])).toMatchObject({
      project_key: 'eq.demo',
      feedback_id: `eq.${FEEDBACK_ID}`,
      order: 'created_at.asc,id.asc',
    });
    expect(snapshots).toEqual([{ ...summaryRow, feedbackId: FEEDBACK_ID }]);
  });

  it('stores files once per project as bytea and reads them back', async () => {
    const repository = createSupabaseScreenSnapshotRepository();
    const stored = 'a'.repeat(64);
    const missing = 'b'.repeat(64);
    responseBodies = [[{ hash: stored }], [], [{ contentType: 'font/woff2', data: '\\x010203' }]];

    expect(await repository.findMissingAssetHashes('demo', [stored, missing, stored])).toEqual([missing]);
    await repository.saveAsset({ projectKey: 'demo', hash: missing, contentType: 'font/woff2', data: new Uint8Array([1, 2, 3]) });
    const asset = await repository.findAsset('demo', stored);

    expect(getSearch(received[0])).toMatchObject({ project_key: 'eq.demo', hash: `in.(${stored},${missing})` });
    expect(received[1].headers.prefer).toContain('resolution=ignore-duplicates');
    expect(getSearch(received[1]).on_conflict).toBe('project_key,hash');
    expect(JSON.parse(received[1].body)).toMatchObject({ project_key: 'demo', hash: missing, byte_size: 3, data: '\\x010203' });
    expect(getSearch(received[2])).toMatchObject({ project_key: 'eq.demo', hash: `eq.${stored}` });
    expect(asset).toEqual({ contentType: 'font/woff2', data: new Uint8Array([1, 2, 3]) });
  });

  it('reports a failed request, an unexpected row, or a missing key as unavailable storage', async () => {
    const repository = createSupabaseScreenSnapshotRepository();
    responseStatus = 500;
    await expect(repository.find('demo', SNAPSHOT_ID)).rejects.toBeInstanceOf(FeedbackStorageUnavailableError);

    responseStatus = 200;
    responseBodies = [[{ ...summaryRow, format: 'html' }]];
    await expect(repository.create(input)).rejects.toBeInstanceOf(FeedbackStorageUnavailableError);

    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_publishable_wrong-kind');
    vi.stubEnv('FEEDBACK_STORAGE', 'supabase');
    expect(() => getScreenSnapshotRepository()).toThrow(FeedbackStorageUnavailableError);
  });
});
