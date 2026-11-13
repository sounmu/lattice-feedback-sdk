import { beforeEach, expect, it, vi } from 'vitest';
import { createFeedbackBody } from '@/app/api/feedback/feedback-test-fixtures';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import type { FeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createFeedbackWithClaimedScreens } from '@/lib/feedback-submission';
import { createMemoryFeedbackRepository, resetMemoryFeedbackStore } from '@/lib/memory-feedback-repository';
import {
  createMemoryScreenSnapshotRepository,
  resetMemoryScreenSnapshotStore,
} from '@/lib/memory-screen-snapshot-repository';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import type { CreateScreenSnapshotInput } from '@/types/screen-snapshot';

const FEEDBACK_ID = '00000000-0000-4000-8000-0000000000f1';
const input = createFeedbackInputSchema.parse(createFeedbackBody());
const screens = createMemoryScreenSnapshotRepository();
const memoryFeedback = createMemoryFeedbackRepository();

async function claimScreen(): Promise<string> {
  const { id } = await screens.create(createScreenSnapshotBody() as CreateScreenSnapshotInput);
  expect(await screens.claimForFeedback('demo', [id], FEEDBACK_ID)).toBe(true);
  return id;
}

function failingCreate(overrides: Partial<FeedbackRepository> = {}): FeedbackRepository {
  return {
    ...memoryFeedback,
    async create(feedbackInput, id) {
      await memoryFeedback.create(feedbackInput, id);
      throw new FeedbackStorageUnavailableError();
    },
    ...overrides,
  };
}

beforeEach(() => {
  resetMemoryFeedbackStore();
  resetMemoryScreenSnapshotStore();
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

it('keeps the screens when the feedback was stored although its response was lost', async () => {
  const screenId = await claimScreen();

  const feedback = await createFeedbackWithClaimedScreens({
    feedbackRepository: failingCreate(),
    screenSnapshotRepository: screens,
    input,
    id: FEEDBACK_ID,
  });

  expect(feedback.id).toBe(FEEDBACK_ID);
  expect((await screens.find('demo', screenId))?.feedbackId).toBe(FEEDBACK_ID);
});

it('releases the screens when the feedback is known not to exist', async () => {
  const screenId = await claimScreen();
  const repository = failingCreate({
    async create() {
      throw new FeedbackStorageUnavailableError();
    },
  });

  await expect(
    createFeedbackWithClaimedScreens({ feedbackRepository: repository, screenSnapshotRepository: screens, input, id: FEEDBACK_ID }),
  ).rejects.toBeInstanceOf(FeedbackStorageUnavailableError);

  expect((await screens.find('demo', screenId))?.feedbackId).toBeNull();
});

it('keeps the link when it cannot tell whether the feedback was stored', async () => {
  const screenId = await claimScreen();
  const repository = failingCreate({
    async create() {
      throw new FeedbackStorageUnavailableError();
    },
    async find() {
      throw new FeedbackStorageUnavailableError();
    },
  });

  await expect(
    createFeedbackWithClaimedScreens({ feedbackRepository: repository, screenSnapshotRepository: screens, input, id: FEEDBACK_ID }),
  ).rejects.toBeInstanceOf(FeedbackStorageUnavailableError);

  expect((await screens.find('demo', screenId))?.feedbackId).toBe(FEEDBACK_ID);
});
