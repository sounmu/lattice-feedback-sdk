import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getFeedbackDetail } from '@/app/api/feedback/[id]/route';
import {
  ADMIN_AUTHORIZATION,
  createFeedbackBody,
  createJsonRequest,
} from '@/app/api/feedback/feedback-test-fixtures';
import { GET as getFeedbackList, POST as postFeedback } from '@/app/api/feedback/route';
import { GET as getSnapshot } from '@/app/api/snapshots/[id]/route';
import { POST } from '@/app/api/snapshots/route';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { MAX_SCREEN_SNAPSHOT_BYTES } from '@/lib/feedback-limits';
import { RATE_LIMIT_MAX_REQUESTS, resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import { resetMemoryScreenSnapshotStore } from '@/lib/memory-screen-snapshot-repository';
import type {
  ApiErrorResponse,
  CreateFeedbackResponse,
  FeedbackDetailResponse,
  FeedbackListResponse,
} from '@/types/feedback';
import type { CreateScreenSnapshotResponse, ScreenSnapshotDetailResponse } from '@/types/screen-snapshot';

const SNAPSHOTS_URL = 'http://localhost:3000/api/snapshots';
const FEEDBACK_URL = 'http://localhost:3000/api/feedback';

interface RejectionCase {
  name: string;
  overrides: Record<string, unknown>;
  headers: Record<string, string>;
  status: number;
  code: string;
}

function createContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postSnapshot(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return POST(createJsonRequest(SNAPSHOTS_URL, 'POST', createScreenSnapshotBody(overrides), headers));
}

async function createSnapshotId(): Promise<string> {
  const body = (await (await postSnapshot()).json()) as CreateScreenSnapshotResponse;
  return body.snapshot.id;
}

function requestSnapshot(id: string, headers: Record<string, string> = {}, projectKey = 'demo') {
  return getSnapshot(new Request(`${SNAPSHOTS_URL}/${id}?projectKey=${projectKey}`, { headers }), createContext(id));
}

async function getErrorCode(response: Response): Promise<string> {
  return ((await response.json()) as ApiErrorResponse).error.code;
}

beforeEach(() => {
  delete process.env.FEEDBACK_ALLOWED_ORIGINS;
  delete process.env.FEEDBACK_ADMIN_TOKEN;
  delete process.env.FEEDBACK_CLIENT_IP_HEADER;
  delete process.env.FEEDBACK_CAPTURE_POLICY;
  delete process.env.FEEDBACK_STORAGE;
  resetMemoryFeedbackStore();
  resetMemoryScreenSnapshotStore();
  resetRateLimit();
});

describe('POST /api/snapshots', () => {
  it('stores a screen from an allowed origin and answers without the event payload', async () => {
    const response = await postSnapshot();
    const body = (await response.json()) as CreateScreenSnapshotResponse;

    expect(response.status).toBe(201);
    expect(body.snapshot).toMatchObject({ projectKey: 'demo', feedbackId: null, page: { scrollY: 120 } });
    expect(body.snapshot).not.toHaveProperty('events');
    expect(body.snapshot).not.toHaveProperty('hostOrigin');
  });

  it.each<RejectionCase>([
    {
      name: 'another site posting directly',
      overrides: {},
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example.com' },
      status: 403,
      code: 'cross_origin_request',
    },
    {
      name: 'a host origin outside the project',
      overrides: { hostOrigin: 'https://evil.example.com' },
      headers: {},
      status: 403,
      code: 'origin_not_allowed',
    },
    {
      name: 'a page that does not belong to the host origin',
      overrides: { page: { ...createScreenSnapshotBody().page, url: 'https://other.example.com/orders' } },
      headers: {},
      status: 400,
      code: 'invalid_body',
    },
    {
      name: 'events that are not Meta followed by FullSnapshot',
      overrides: { events: [...createScreenSnapshotBody().events].reverse() },
      headers: {},
      status: 400,
      code: 'invalid_body',
    },
    {
      name: 'an unknown snapshot format',
      overrides: { format: 'html' },
      headers: {},
      status: 400,
      code: 'invalid_body',
    },
    {
      name: 'a declared body above the size limit',
      overrides: {},
      headers: { 'content-length': String(MAX_SCREEN_SNAPSHOT_BYTES + 1) },
      status: 413,
      code: 'payload_too_large',
    },
  ])('rejects $name', async ({ overrides, headers, status, code }) => {
    const response = await postSnapshot(overrides, headers);

    expect(response.status).toBe(status);
    expect(await getErrorCode(response)).toBe(code);
  });

  it('allows every page by default and only the listed paths once the project sets a policy', async () => {
    expect((await postSnapshot()).status).toBe(201);

    process.env.FEEDBACK_CAPTURE_POLICY = JSON.stringify({ allowedPaths: ['/'], targets: [] });
    const restricted = await postSnapshot();
    expect(restricted.status).toBe(403);
    expect(await getErrorCode(restricted)).toBe('capture_not_allowed');

    process.env.FEEDBACK_CAPTURE_POLICY = JSON.stringify({ allowedPaths: ['/orders'], targets: [] });
    expect((await postSnapshot()).status).toBe(201);
  });

  it('answers 503 under Supabase storage instead of keeping the screen in memory', async () => {
    process.env.FEEDBACK_STORAGE = 'supabase';
    const response = await postSnapshot();

    expect(response.status).toBe(503);
    expect(await getErrorCode(response)).toBe('storage_unavailable');
  });

  it('limits saved screens without spending the feedback submission limit', async () => {
    for (let count = 0; count < RATE_LIMIT_MAX_REQUESTS; count += 1) {
      expect((await postSnapshot()).status).toBe(201);
    }

    expect((await postSnapshot()).status).toBe(429);
    const feedback = await postFeedback(createJsonRequest(FEEDBACK_URL, 'POST', createFeedbackBody()));
    expect(feedback.status).toBe(201);
  });
});

describe('GET /api/snapshots/[id]', () => {
  it('returns the full screen to the project admin only', async () => {
    const id = await createSnapshotId();

    const response = await requestSnapshot(id, { authorization: ADMIN_AUTHORIZATION });
    const body = (await response.json()) as ScreenSnapshotDetailResponse;
    expect(response.status).toBe(200);
    expect(body.snapshot.events).toEqual(createScreenSnapshotBody().events);

    expect((await requestSnapshot(id)).status).toBe(401);
    expect((await requestSnapshot(id, { authorization: 'Bearer wrong-token' })).status).toBe(401);
    expect((await requestSnapshot(id, { authorization: ADMIN_AUTHORIZATION }, 'other')).status).toBe(404);
    expect((await requestSnapshot(crypto.randomUUID(), { authorization: ADMIN_AUTHORIZATION })).status).toBe(404);
  });
});

describe('saved screens on feedback', () => {
  async function submitFeedback(screenSnapshotIds: string[]) {
    return postFeedback(createJsonRequest(FEEDBACK_URL, 'POST', createFeedbackBody({ screenSnapshotIds })));
  }

  it('links a saved screen to the feedback it is submitted with, exactly once', async () => {
    const snapshotId = await createSnapshotId();

    const created = await submitFeedback([snapshotId]);
    const feedbackId = ((await created.json()) as CreateFeedbackResponse).feedback.id;
    const detailResponse = await getFeedbackDetail(
      new Request(`${FEEDBACK_URL}/${feedbackId}?projectKey=demo`, { headers: { authorization: ADMIN_AUTHORIZATION } }),
      createContext(feedbackId),
    );
    const detail = (await detailResponse.json()) as FeedbackDetailResponse;

    expect(created.status).toBe(201);
    expect(detail.screenSnapshots).toHaveLength(1);
    expect(detail.screenSnapshots[0]).toMatchObject({ id: snapshotId, feedbackId });
    expect(detail.screenSnapshots[0]).not.toHaveProperty('events');

    const reused = await submitFeedback([snapshotId]);
    expect(reused.status).toBe(400);
    expect(await getErrorCode(reused)).toBe('screen_snapshot_not_found');
  });

  it('lets only one of two simultaneous submissions take the same screen', async () => {
    const snapshotId = await createSnapshotId();

    const responses = await Promise.all([submitFeedback([snapshotId]), submitFeedback([snapshotId])]);
    const list = await getFeedbackList(
      new Request(`${FEEDBACK_URL}?projectKey=demo`, { headers: { authorization: ADMIN_AUTHORIZATION } }),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    expect(((await list.json()) as FeedbackListResponse).items).toHaveLength(1);
  });

  it('rejects an unknown screen without storing the feedback', async () => {
    const response = await submitFeedback([crypto.randomUUID()]);
    const list = await getFeedbackList(
      new Request(`${FEEDBACK_URL}?projectKey=demo`, { headers: { authorization: ADMIN_AUTHORIZATION } }),
    );

    expect(response.status).toBe(400);
    expect(((await list.json()) as FeedbackListResponse).items).toHaveLength(0);
  });
});
