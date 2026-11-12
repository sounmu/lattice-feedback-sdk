import { beforeEach, describe, expect, it } from 'vitest';

import { createFeedbackBody } from '@/app/api/feedback/feedback-test-fixtures';
import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import {
  createMemoryFeedbackRepository,
  MAX_FEEDBACK_PER_PROJECT,
  resetMemoryFeedbackStore,
} from '@/lib/memory-feedback-repository';
import type { CreateFeedbackInput } from '@/types/feedback';

beforeEach(() => {
  resetMemoryFeedbackStore();
});

describe('memory feedback repository', () => {
  it('refuses new feedback when full instead of evicting the oldest item', async () => {
    const repository = createMemoryFeedbackRepository();
    const input = createFeedbackBody() as CreateFeedbackInput;
    const first = await repository.create({ ...input, message: 'oldest' });
    for (let index = 1; index < MAX_FEEDBACK_PER_PROJECT; index += 1) {
      await repository.create(input);
    }

    await expect(repository.create(input)).rejects.toBeInstanceOf(FeedbackStorageFullError);
    expect(await repository.find('demo', first.id)).not.toBeNull();
    expect(await repository.findMany('demo')).toHaveLength(MAX_FEEDBACK_PER_PROJECT);
  });
});
