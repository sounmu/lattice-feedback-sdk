import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFeedbackBody } from '@/app/api/feedback/feedback-test-fixtures';
import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import {
  createMemoryFeedbackRepository,
  MAX_FEEDBACK_PER_PROJECT,
  resetMemoryFeedbackStore,
} from '@/lib/memory-feedback-repository';
import { TICKET_CLAIM_TTL_MS } from '@/lib/ticket-limits';
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

  describe('ticket claim', () => {
    async function createOne() {
      const repository = createMemoryFeedbackRepository();
      const feedback = await repository.create(createFeedbackBody() as CreateFeedbackInput);
      return { repository, id: feedback.id };
    }

    it('gives the right to one of two claims at the same moment', async () => {
      const { repository, id } = await createOne();

      const claims = await Promise.all([repository.claimTicket('demo', id), repository.claimTicket('demo', id)]);

      expect(claims.map((claim) => claim?.status).sort()).toEqual(['claimed', 'in_progress']);
    });

    it('returns the saved link to every later claim, in any project only for its own feedback', async () => {
      const { repository, id } = await createOne();
      await repository.claimTicket('demo', id);

      await repository.saveTicketUrl('demo', id, 'https://www.notion.so/t');

      expect(await repository.claimTicket('demo', id)).toEqual({ status: 'created', url: 'https://www.notion.so/t' });
      expect(await repository.claimTicket('other', id)).toBeNull();
    });

    it('lets a claim be taken again after it is released or lapses', async () => {
      vi.useFakeTimers();
      try {
        const { repository, id } = await createOne();
        await repository.claimTicket('demo', id);
        await repository.releaseTicket('demo', id);
        expect((await repository.claimTicket('demo', id))?.status).toBe('claimed');

        expect((await repository.claimTicket('demo', id))?.status).toBe('in_progress');
        vi.advanceTimersByTime(TICKET_CLAIM_TTL_MS);
        expect((await repository.claimTicket('demo', id))?.status).toBe('claimed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not claim a feedback that does not exist', async () => {
      const repository = createMemoryFeedbackRepository();

      expect(await repository.claimTicket('demo', 'missing')).toBeNull();
      expect(await repository.saveTicketUrl('demo', 'missing', 'https://www.notion.so/t')).toBeNull();
    });
  });
});
