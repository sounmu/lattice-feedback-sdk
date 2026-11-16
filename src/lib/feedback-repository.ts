import { createMemoryFeedbackRepository } from '@/lib/memory-feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createSupabaseFeedbackRepository } from '@/lib/supabase-feedback-repository';
import type { CreateFeedbackInput, Feedback, UpdateFeedbackInput } from '@/types/feedback';
import type { ConversationAccess, ConversationCredentials } from '@/types/conversation';
import type { TicketClaim } from '@/types/ticket';

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
  /**
   * Takes the right to make the feedback's ticket, in one step, so two requests at once cannot both get it.
   * Returns null when the feedback does not exist, 'created' with the saved link when a ticket was already made,
   * and 'in_progress' while another request holds the right (it lapses after TICKET_CLAIM_TTL_MS).
   */
  claimTicket(projectKey: string, id: string): Promise<TicketClaim | null>;
  /** Saves the link of the made ticket and ends the claim. Does not change updatedAt. */
  saveTicketUrl(projectKey: string, id: string, url: string): Promise<Feedback | null>;
  /** Gives the right back after a failure that made no ticket, so the administrator can try again. */
  releaseTicket(projectKey: string, id: string): Promise<void>;
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
