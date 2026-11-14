import type { Feedback, FeedbackStatus, UpdateFeedbackInput } from '@/types/feedback';

/** What the admin has set in the action panel. */
export interface FeedbackActionForm {
  status: FeedbackStatus;
  reply: string;
  /** Id of the chosen original, or an empty string. */
  duplicateOfId: string;
}

/** What saving the form would send for a feedback. Empty when nothing changed. */
export function createFeedbackChanges(
  feedback: Pick<Feedback, 'status' | 'adminReply' | 'duplicateOfId'>,
  form: FeedbackActionForm,
): UpdateFeedbackInput {
  const changes: UpdateFeedbackInput = {};
  const isOriginalChanged = form.status === 'duplicate' && form.duplicateOfId !== (feedback.duplicateOfId ?? '');
  if (form.status !== feedback.status || isOriginalChanged) {
    changes.status = form.status;
    if (form.status === 'duplicate') {
      changes.duplicateOfId = form.duplicateOfId;
    }
  }
  const reply = form.reply.trim();
  if (reply !== (feedback.adminReply ?? '')) {
    changes.adminReply = reply === '' ? null : reply;
  }
  return changes;
}
