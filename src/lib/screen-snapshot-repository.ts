import { getFeedbackStorageMode } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createMemoryScreenSnapshotRepository } from '@/lib/memory-screen-snapshot-repository';
import { createSupabaseScreenSnapshotRepository } from '@/lib/supabase-screen-snapshot-repository';
import type { CreateScreenSnapshotInput, ScreenSnapshot, ScreenSnapshotSummary } from '@/types/screen-snapshot';

export interface ScreenSnapshotRepository {
  create(input: CreateScreenSnapshotInput): Promise<ScreenSnapshotSummary>;
  find(projectKey: string, id: string): Promise<ScreenSnapshot | null>;
  /** Oldest first. */
  findManyByFeedback(projectKey: string, feedbackId: string): Promise<ScreenSnapshotSummary[]>;
  /** True when every id exists in the project and is not linked to a feedback yet. */
  isAttachable(projectKey: string, ids: readonly string[]): Promise<boolean>;
  attachToFeedback(projectKey: string, ids: readonly string[], feedbackId: string): Promise<void>;
}

const memoryScreenSnapshotRepository = createMemoryScreenSnapshotRepository();

// Follows the feedback storage mode, so a screen and its feedback always live in the same store.
export function getScreenSnapshotRepository(): ScreenSnapshotRepository {
  switch (getFeedbackStorageMode()) {
    case 'memory':
      return memoryScreenSnapshotRepository;
    case 'supabase':
      return createSupabaseScreenSnapshotRepository();
    default:
      throw new FeedbackStorageUnavailableError();
  }
}
