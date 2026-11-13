import { getFeedbackStorageMode } from '@/lib/feedback-repository';
import { createMemoryScreenSnapshotRepository } from '@/lib/memory-screen-snapshot-repository';
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

// Saved screens have a memory store only. Under Supabase feedback storage there is no screen
// store yet, and nothing falls back to memory silently: callers get null and answer 503.
export function findScreenSnapshotRepository(): ScreenSnapshotRepository | null {
  if (getFeedbackStorageMode() === 'memory') {
    return memoryScreenSnapshotRepository;
  }
  return null;
}
