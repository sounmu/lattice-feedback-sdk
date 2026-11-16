import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as detail } from '@/app/api/feedback/[id]/route';
import { ADMIN_AUTHORIZATION, createFeedbackBody } from '@/app/api/feedback/feedback-test-fixtures';
import { GET as getAsset } from '@/app/api/snapshots/assets/[hash]/route';
import { GET as getSnapshot } from '@/app/api/snapshots/[id]/route';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import { resetMemoryScreenSnapshotStore } from '@/lib/memory-screen-snapshot-repository';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import { createScreenSnapshotInputSchema } from '@/lib/validation/screen-snapshot-schema';

const FEEDBACK_ID = '00000000-0000-4000-8000-000000000001';
const FONT = new TextEncoder().encode('font-bytes');
const FONT_HASH = createHash('sha256').update(FONT).digest('hex');
const TIMING_ENTRY_PATTERN = /^(auth|db|serialize|gzip|total);dur=\d+\.\d$/;
const HEADERS = { authorization: ADMIN_AUTHORIZATION };

beforeEach(() => {
  vi.stubEnv('FEEDBACK_STORAGE', 'memory');
  vi.stubEnv('FEEDBACK_ADMIN_TOKEN', 'dev-admin-token');
  vi.stubEnv('FEEDBACK_ALLOWED_ORIGINS', 'http://localhost:4000');
  resetMemoryFeedbackStore();
  resetMemoryScreenSnapshotStore();
  resetRateLimit();
});

afterEach(() => vi.unstubAllEnvs());

function readPhases(response: Response): string[] {
  const header = response.headers.get('server-timing');
  expect(header).not.toBeNull();
  const entries = (header ?? '').split(', ');
  entries.forEach((entry) => expect(entry).toMatch(TIMING_ENTRY_PATTERN));
  return entries.map((entry) => entry.split(';')[0]);
}

async function createSnapshot() {
  const created = await getScreenSnapshotRepository().create(createScreenSnapshotInputSchema.parse(createScreenSnapshotBody()));
  return created.id;
}

describe('Server-Timing', () => {
  it('times the feedback detail and carries nothing but phase names and durations', async () => {
    await getFeedbackRepository().create(createFeedbackInputSchema.parse(createFeedbackBody()), FEEDBACK_ID);
    const url = `http://localhost:3000/api/feedback/${FEEDBACK_ID}?projectKey=demo`;

    const response = await detail(new Request(url, { headers: HEADERS }), { params: Promise.resolve({ id: FEEDBACK_ID }) });
    const revalidated = await detail(new Request(url, { headers: { ...HEADERS, 'if-none-match': '*' } }), {
      params: Promise.resolve({ id: FEEDBACK_ID }),
    });

    expect(readPhases(response)).toEqual(['auth', 'db', 'serialize', 'total']);
    expect(revalidated.status).toBe(304);
    expect(readPhases(revalidated)).toEqual(['auth', 'db', 'serialize', 'total']);
    expect(response.headers.get('server-timing')).not.toMatch(/dev-admin-token|hidden on mobile|demo/);
  });

  it.each([
    { accept: 'application/json', phases: ['auth', 'db', 'serialize', 'total'] },
    { accept: 'application/gzip', phases: ['auth', 'db', 'serialize', 'gzip', 'total'] },
  ])('times the saved screen served as $accept', async ({ accept, phases }) => {
    const id = await createSnapshot();

    const response = await getSnapshot(new Request(`http://localhost:3000/api/snapshots/${id}?projectKey=demo`, {
      headers: { ...HEADERS, accept },
    }), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(200);
    expect(readPhases(response)).toEqual(phases);
    expect(response.headers.get('vary')).toBe('Accept, Authorization');
  });

  it('times a saved file whether it is sent or revalidated', async () => {
    await getScreenSnapshotRepository().saveAsset({ projectKey: 'demo', hash: FONT_HASH, contentType: 'font/woff2', data: FONT });
    const request = (headers: Record<string, string>) =>
      getAsset(new Request(`http://localhost:3000/api/snapshots/assets/${FONT_HASH}?projectKey=demo`, { headers }), {
        params: Promise.resolve({ hash: FONT_HASH }),
      });

    const sent = await request(HEADERS);
    const revalidated = await request({ ...HEADERS, 'if-none-match': `"${FONT_HASH}"` });

    expect(sent.status).toBe(200);
    expect(readPhases(sent)).toEqual(['auth', 'db', 'total']);
    expect(revalidated.status).toBe(304);
    expect(readPhases(revalidated)).toEqual(['auth', 'db', 'total']);
  });
});
