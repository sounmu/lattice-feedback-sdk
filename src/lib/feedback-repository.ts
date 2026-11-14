import { createMemoryFeedbackRepository } from '@/lib/memory-feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createSupabaseFeedbackRepository } from '@/lib/supabase-feedback-repository';
import type { CreateFeedbackInput, Feedback, UpdateFeedbackInput } from '@/types/feedback';

export interface FeedbackRepository {
  /** Uses the given id when present, so related records can be claimed for it before it exists. */
  create(input: CreateFeedbackInput, id?: string): Promise<Feedback>;
  /** Newest first. */
  findMany(projectKey: string): Promise<Feedback[]>;
  find(projectKey: string, id: string): Promise<Feedback | null>;
  /**
   * Throws FeedbackDuplicateTargetError when a new duplicateOfId cannot be an original. The store checks and
   * writes in one step, so two admins cannot point two feedbacks at each other.
   */
  update(projectKey: string, id: string, input: UpdateFeedbackInput): Promise<Feedback | null>;
}

const memoryFeedbackRepository = createMemoryFeedbackRepository();

export function getFeedbackStorageMode(): string {
  return process.env.FEEDBACK_STORAGE ?? (process.env.NODE_ENV === 'production' ? 'supabase' : 'memory');
}

export function getFeedbackRepository(): FeedbackRepository {
  switch (getFeedbackStorageMode()) {
    case 'memory':
      return memoryFeedbackRepository;
    case 'supabase':
      return createSupabaseFeedbackRepository();
    default:
      throw new FeedbackStorageUnavailableError();
  }
}
