import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as detail } from '@/app/api/feedback/[id]/route';
import { ADMIN_AUTHORIZATION, createFeedbackBody } from '@/app/api/feedback/feedback-test-fixtures';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { resetRateLimit } from '@/lib/http/rate-limit';
import { resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import { resetMemoryScreenSnapshotStore } from '@/lib/memory-screen-snapshot-repository';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';

const ID = '00000000-0000-4000-8000-000000000001';
const URL = `http://localhost:3000/api/feedback/${ID}?projectKey=demo`;
const CONTEXT = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  resetMemoryFeedbackStore();
  resetMemoryScreenSnapshotStore();
  resetRateLimit();
});

afterEach(() => vi.restoreAllMocks());

it('reads the saved screens while the feedback read is still pending', async () => {
  const feedback = await getFeedbackRepository().create(createFeedbackInputSchema.parse(createFeedbackBody()), ID);
  const screensRequested = new Promise<void>((resolve) => {
    vi.spyOn(getScreenSnapshotRepository(), 'findManyByFeedback').mockImplementation(async () => {
      resolve();
      return [];
    });
  });
  vi.spyOn(getFeedbackRepository(), 'find').mockImplementation(async () => {
    await screensRequested;
    return feedback;
  });

  const response = await detail(new Request(URL, { headers: { authorization: ADMIN_AUTHORIZATION } }), CONTEXT);

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ feedback: { id: ID }, screenSnapshots: [] });
});

it('reads only the requested project and still answers 404 for a missing feedback', async () => {
  const findScreens = vi.spyOn(getScreenSnapshotRepository(), 'findManyByFeedback');

  const response = await detail(new Request(URL, { headers: { authorization: ADMIN_AUTHORIZATION } }), CONTEXT);

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: 'feedback_not_found' } });
  expect(findScreens).toHaveBeenCalledWith('demo', ID);
});
