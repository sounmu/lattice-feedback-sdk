import { createMemoryFeedbackRepository } from '@/lib/memory-feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createSupabaseFeedbackRepository } from '@/lib/supabase-feedback-repository';
import type { CreateFeedbackInput, Feedback, UpdateFeedbackInput } from '@/types/feedback';
import type { ConversationAccess, ConversationCredentials } from '@/types/conversation';

export interface FeedbackRepository {
  /** Uses the given id when present, so related records can be claimed for it before it exists. */
  create(input: CreateFeedbackInput, id?: string, access?: ConversationAccess): Promise<Feedback>;
  /** Newest first. */
  findMany(projectKey: string, credentials?: ConversationCredentials): Promise<Feedback[]>;
  find(projectKey: string, id: string, credentials?: ConversationCredentials): Promise<Feedback | null>;
  appendReporterMessage(projectKey: string, id: string, message: { credentials: ConversationCredentials; body: string }): Promise<Feedback | null>;
  /**
   * Throws FeedbackDuplicateTargetError when a new duplicateOfId cannot be an original. The store checks and
   * writes in one step, so two admins cannot point two feedbacks at each other. When a feedback that has
   * duplicates becomes a duplicate itself, the store moves those duplicates to its original in the same step.
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
