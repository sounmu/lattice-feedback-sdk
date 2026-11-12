import { createMemoryFeedbackRepository } from '@/lib/memory-feedback-repository';
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
  return memoryFeedbackRepository;
}
