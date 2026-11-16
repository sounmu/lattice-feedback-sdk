import { assert, beforeEach, expect, it } from 'vitest';
import { GET as list } from '@/app/api/feedback/route';
import { GET as detail, PATCH } from '@/app/api/feedback/[id]/route';
import { ADMIN_AUTHORIZATION, createFeedbackBody, createJsonRequest } from '@/app/api/feedback/feedback-test-fixtures';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import { resetMemoryScreenSnapshotStore } from '@/lib/memory-screen-snapshot-repository';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import { createScreenSnapshotInputSchema } from '@/lib/validation/screen-snapshot-schema';

const BASE = 'http://localhost:3000/api/feedback';
const ID = '00000000-0000-4000-8000-000000000001';
const CONTEXT = { params: Promise.resolve({ id: ID }) };
const HEADERS = { authorization: ADMIN_AUTHORIZATION };
const ENDPOINTS = [
  { name: 'list', url: `${BASE}?projectKey=demo`, get: list },
  { name: 'detail', url: `${BASE}/${ID}?projectKey=demo`, get: detail },
] as const;

beforeEach(async () => {
  resetMemoryFeedbackStore();
  resetMemoryScreenSnapshotStore();
  resetRateLimit();
  await getFeedbackRepository().create(createFeedbackInputSchema.parse(createFeedbackBody()), ID);
});

it.each(ENDPOINTS)('revalidates the private $name representation with weak, strong, and listed tags', async ({ url, get }) => {
  const first = await get(new Request(url, { headers: HEADERS }), CONTEXT);
  const tag = first.headers.get('etag');
  assert(tag);
  expect(first.headers.get('cache-control')).toBe('private, no-cache');
  expect(first.headers.get('vary')).toBe('Authorization');
  const strongTag = tag.replace(/^W\//, '');

  for (const validator of [tag, strongTag, `"stale", ${tag}`, '*']) {
    const response = await get(new Request(url, { headers: { ...HEADERS, 'if-none-match': validator } }), CONTEXT);

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('etag')).toBe(tag);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('vary')).toBe('Authorization');
  }
});

it.each(ENDPOINTS)('returns the current $name body when a conditional tag differs', async ({ url, get }) => {
  const first = await get(new Request(url, { headers: HEADERS }), CONTEXT);
  const expected: unknown = await first.json();

  const response = await get(new Request(url, { headers: { ...HEADERS, 'if-none-match': '"stale"' } }), CONTEXT);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected);
});

it.each(ENDPOINTS)('checks authorization before conditional $name responses and prevents caching failures', async ({ url, get }) => {
  const response = await get(new Request(url, { headers: { 'if-none-match': '*' } }), CONTEXT);

  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('etag')).toBeNull();
});

it.each(ENDPOINTS)('rejects another project before conditional $name responses', async ({ url, get }) => {
  const response = await get(new Request(url.replace('projectKey=demo', 'projectKey=other'), {
    headers: { ...HEADERS, 'if-none-match': '*' },
  }), CONTEXT);

  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it.each(ENDPOINTS)('invalidates the $name tag after an admin reply', async ({ url, get }) => {
  const first = await get(new Request(url, { headers: HEADERS }), CONTEXT);
  const tag = first.headers.get('etag');
  assert(tag);
  await getFeedbackRepository().update('demo', ID, { adminReply: 'A new answer' });

  const response = await get(new Request(url, { headers: { ...HEADERS, 'if-none-match': tag } }), CONTEXT);

  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).not.toBe(tag);
  expect(await response.text()).toContain('A new answer');
});

it('invalidates the detail tag when a screen is linked without changing the feedback timestamp', async () => {
  const url = `${BASE}/${ID}?projectKey=demo`;
  const first = await detail(new Request(url, { headers: HEADERS }), CONTEXT);
  const tag = first.headers.get('etag');
  assert(tag);
  const screens = getScreenSnapshotRepository();
  const screen = await screens.create(createScreenSnapshotInputSchema.parse(createScreenSnapshotBody()));
  await screens.claimForFeedback('demo', [screen.id], ID);

  const response = await detail(new Request(url, { headers: { ...HEADERS, 'if-none-match': tag } }), CONTEXT);

  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).not.toBe(tag);
  expect(await response.json()).toMatchObject({ screenSnapshots: [{ id: screen.id }] });
});

it('does not reuse a detail tag after duplicate links move without changing their timestamps', async () => {
  const repository = getFeedbackRepository();
  const input = createFeedbackInputSchema.parse(createFeedbackBody());
  const second = await repository.create(input);
  const third = await repository.create(input);
  await repository.update('demo', ID, { status: 'duplicate', duplicateOfId: second.id });
  const url = `${BASE}/${ID}?projectKey=demo`;
  const first = await detail(new Request(url, { headers: HEADERS }), CONTEXT);
  const tag = first.headers.get('etag');
  assert(tag);
  await repository.update('demo', second.id, { status: 'duplicate', duplicateOfId: third.id });

  const response = await detail(new Request(url, { headers: { ...HEADERS, 'if-none-match': tag } }), CONTEXT);

  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).not.toBe(tag);
  expect(await response.json()).toMatchObject({ feedback: { duplicateOfId: third.id } });
});

it('keeps successful mutations uncacheable and ignores read validators on PATCH', async () => {
  const response = await PATCH(createJsonRequest(`${BASE}/${ID}?projectKey=demo`, 'PATCH', {
    status: 'resolved',
  }, { ...HEADERS, 'if-none-match': '*' }), CONTEXT);

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ feedback: { status: 'resolved' } });
});
