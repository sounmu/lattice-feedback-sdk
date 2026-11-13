import type { FeedbackRepository } from '@/lib/feedback-repository';
import type { ScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import type { CreateFeedbackInput, Feedback } from '@/types/feedback';

interface CreateFeedbackWithClaimedScreensInput {
  feedbackRepository: FeedbackRepository;
  screenSnapshotRepository: ScreenSnapshotRepository;
  input: CreateFeedbackInput;
  /** The id the screens were already claimed for. */
  id: string;
}

// The INSERT may commit even when its response is lost, so a failed create is reconciled by id:
// a stored feedback keeps its screens, a missing one releases them, and an unknown state keeps the link.
export async function createFeedbackWithClaimedScreens({
  feedbackRepository,
  screenSnapshotRepository,
  input,
  id,
}: CreateFeedbackWithClaimedScreensInput): Promise<Feedback> {
  try {
    return await feedbackRepository.create(input, id);
  } catch (error) {
    let stored: Feedback | null;
    try {
      stored = await feedbackRepository.find(input.projectKey, id);
    } catch (findError) {
      console.error('Checking whether failed feedback was stored failed; its screens stay linked.', findError);
      throw error;
    }
    if (stored) {
      return stored;
    }
    await screenSnapshotRepository
      .releaseFromFeedback(input.projectKey, id)
      .catch((releaseError: unknown) => console.error('Releasing saved screens of unsaved feedback failed.', releaseError));
    throw error;
  }
}
