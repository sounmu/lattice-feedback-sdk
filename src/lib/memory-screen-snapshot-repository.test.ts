import { beforeEach, expect, it } from 'vitest';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import {
  createMemoryScreenSnapshotRepository,
  MAX_SCREEN_SNAPSHOTS_PER_PROJECT,
  resetMemoryScreenSnapshotStore,
} from '@/lib/memory-screen-snapshot-repository';
import type { CreateScreenSnapshotInput } from '@/types/screen-snapshot';

const INPUT = createScreenSnapshotBody() as CreateScreenSnapshotInput;
const repository = createMemoryScreenSnapshotRepository();

async function fillStore(): Promise<string[]> {
  const ids: string[] = [];
  for (let count = 0; count < MAX_SCREEN_SNAPSHOTS_PER_PROJECT; count += 1) {
    ids.push((await repository.create(INPUT)).id);
  }
  return ids;
}

beforeEach(() => resetMemoryScreenSnapshotStore());

it('makes room by dropping the oldest screen that was never submitted', async () => {
  const [submittedId, oldestUnsubmittedId, laterId] = await fillStore();
  await repository.attachToFeedback('demo', [submittedId], 'feedback-1');

  await repository.create(INPUT);

  expect(await repository.find('demo', submittedId)).not.toBeNull();
  expect(await repository.find('demo', oldestUnsubmittedId)).toBeNull();
  expect(await repository.find('demo', laterId)).not.toBeNull();
});

it('refuses a new screen when every stored one belongs to a feedback', async () => {
  const ids = await fillStore();
  await repository.attachToFeedback('demo', ids, 'feedback-1');

  await expect(repository.create(INPUT)).rejects.toBeInstanceOf(FeedbackStorageFullError);
  expect(await repository.findManyByFeedback('demo', 'feedback-1')).toHaveLength(MAX_SCREEN_SNAPSHOTS_PER_PROJECT);
});
