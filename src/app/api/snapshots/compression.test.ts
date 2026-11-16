import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GET } from '@/app/api/snapshots/[id]/route';
import { POST } from '@/app/api/snapshots/route';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { MAX_SCREEN_SNAPSHOT_BYTES, MAX_SCREEN_SNAPSHOT_UNPACKED_BYTES } from '@/lib/feedback-limits';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryScreenSnapshotStore } from '@/lib/memory-screen-snapshot-repository';

const URL = 'http://localhost:3000/api/snapshots';
const HEADERS = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/gzip' };
const JSON_BODY = JSON.stringify(createScreenSnapshotBody());
const createdSchema = z.object({ snapshot: z.object({ id: z.string() }) });

beforeEach(() => {
  vi.stubEnv('FEEDBACK_STORAGE', 'memory');
  vi.stubEnv('FEEDBACK_ADMIN_TOKEN', 'compression-test-token');
  vi.stubEnv('FEEDBACK_ALLOWED_ORIGINS', 'http://localhost:4000');
  resetRateLimit();
  resetMemoryScreenSnapshotStore();
});

afterEach(() => vi.unstubAllEnvs());

describe('saved screen compression transport', () => {
  it('accepts exactly the unpacked byte limit without imposing the wire limit on decoded JSON', async () => {
    const body = gzipSync(JSON_BODY.padEnd(MAX_SCREEN_SNAPSHOT_UNPACKED_BYTES, ' '));

    const response = await POST(new Request(URL, { method: 'POST', headers: HEADERS, body }));

    expect(response.status).toBe(201);
  });

  const valid = gzipSync(JSON_BODY);
  it.each([
    { name: 'truncated', body: valid.subarray(0, valid.length - 4) },
    { name: 'checksum-damaged', body: Buffer.concat([valid.subarray(0, -8), new Uint8Array(4), valid.subarray(-4)]) },
    { name: 'concatenated', body: Buffer.concat([valid, gzipSync(' ')]) },
    { name: 'zero-padded', body: Buffer.concat([valid, new Uint8Array(4)]) },
  ])('rejects a $name gzip file before saving', async ({ body }) => {
    const response = await POST(new Request(URL, { method: 'POST', headers: HEADERS, body }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_body' } });
  });

  it('rejects valid gzip containing invalid JSON with the JSON error', async () => {
    const response = await POST(new Request(URL, { method: 'POST', headers: HEADERS, body: gzipSync('{') }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_json' } });
  });

  it('cancels a gzip upload when its undeclared wire size crosses the limit', async () => {
    let cancelled = false;
    let pulledChunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulledChunks += 1;
        controller.enqueue(new Uint8Array(MAX_SCREEN_SNAPSHOT_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const init = { method: 'POST', headers: HEADERS, body, duplex: 'half' };

    const response = await POST(new Request(URL, init));

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulledChunks).toBeLessThanOrEqual(2);
  });

  it.each(['application/json', 'application/gzip'])('preserves Unicode and varies the %s response by format and credentials without HTTP content encoding', async (accept) => {
    const input = createScreenSnapshotBody({ events: [
      ...createScreenSnapshotBody().events,
      { type: 3, timestamp: 2, data: { source: 0, adds: [], removes: [], attributes: [],
        texts: [{ id: 1, value: '\ud55c\uae00 \ud83d\ude00'.repeat(20_000) }],
      } },
    ] });
    input.page.title = '\ud55c\uae00 \ud654\uba74 \ud83d\ude00';
    const created = await POST(new Request(URL, { method: 'POST', headers: HEADERS, body: gzipSync(JSON.stringify(input)) }));
    const id = createdSchema.parse(await created.json()).snapshot.id;

    const response = await GET(new Request(`${URL}/${id}?projectKey=demo`, {
      headers: { authorization: 'Bearer compression-test-token', accept },
    }), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(200);
    expect(response.headers.get('vary')).toBe('Accept, Authorization');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-encoding')).toBeNull();
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = accept === 'application/gzip' ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
    expect(JSON.parse(text)).toMatchObject({ snapshot: { page: input.page, events: input.events } });
  });
});
