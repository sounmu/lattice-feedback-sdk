import { getFeedbackStorageMode } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createMemoryScreenSnapshotRepository } from '@/lib/memory-screen-snapshot-repository';
import { createSupabaseScreenSnapshotRepository } from '@/lib/supabase-screen-snapshot-repository';
import type {
  CreateScreenSnapshotInput,
  ScreenSnapshot,
  ScreenSnapshotAssetFile,
  ScreenSnapshotSummary,
} from '@/types/screen-snapshot';

export interface SaveScreenSnapshotAssetInput extends ScreenSnapshotAssetFile {
  projectKey: string;
  /** SHA-256 of data, already verified by the caller. */
  hash: string;
}

export interface ScreenSnapshotRepository {
  create(input: CreateScreenSnapshotInput): Promise<ScreenSnapshotSummary>;
  find(projectKey: string, id: string): Promise<ScreenSnapshot | null>;
  /** Oldest first. */
  findManyByFeedback(projectKey: string, feedbackId: string): Promise<ScreenSnapshotSummary[]>;
  /**
   * Links every screen to the feedback id if all of them exist in the project and are still unlinked.
   * Otherwise links none (releasing any it took) and returns false.
   */
  claimForFeedback(projectKey: string, ids: readonly string[], feedbackId: string): Promise<boolean>;
  /** Unlinks the screens claimed for a feedback that was never stored. */
  releaseFromFeedback(projectKey: string, feedbackId: string): Promise<void>;
  /** Hashes from the list that the project has not stored yet. */
  findMissingAssetHashes(projectKey: string, hashes: readonly string[]): Promise<string[]>;
  /** Storing a hash the project already has is a no-op. */
  saveAsset(input: SaveScreenSnapshotAssetInput): Promise<void>;
  findAsset(projectKey: string, hash: string): Promise<ScreenSnapshotAssetFile | null>;
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
