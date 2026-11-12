import { createMemoryFeedbackRepository } from '@/lib/memory-feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createSupabaseFeedbackRepository } from '@/lib/supabase-feedback-repository';
import type { CreateFeedbackInput, Feedback, UpdateFeedbackInput } from '@/types/feedback';

export interface FeedbackRepository {
  create(input: CreateFeedbackInput): Promise<Feedback>;
  /** Newest first. */
  findMany(projectKey: string): Promise<Feedback[]>;
  find(projectKey: string, id: string): Promise<Feedback | null>;
  update(projectKey: string, id: string, input: UpdateFeedbackInput): Promise<Feedback | null>;
}

const memoryFeedbackRepository = createMemoryFeedbackRepository();

export function getFeedbackRepository(): FeedbackRepository {
  const storage = process.env.FEEDBACK_STORAGE ?? (process.env.NODE_ENV === 'production' ? 'supabase' : 'memory');
  switch (storage) {
    case 'memory':
      return memoryFeedbackRepository;
    case 'supabase':
      return createSupabaseFeedbackRepository();
    default:
      throw new FeedbackStorageUnavailableError();
  }
}
