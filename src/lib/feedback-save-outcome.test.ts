import { describe, expect, it } from 'vitest';

import { findReplyDraft, saveReplyDraft, type ReplyDraftStorage } from '@/lib/admin-reply-drafts';
import { findSaveOutcome } from '@/lib/feedback-save-outcome';

function createStorage(): ReplyDraftStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const FIRST = { id: 'feedback-1', projectKey: 'demo', adminReply: null };
const SECOND = { id: 'feedback-2', projectKey: 'demo', adminReply: null };

describe('save outcome', () => {
  it('reports server success even when another feedback is selected by the time the response arrives', () => {
    expect(findSaveOutcome(true, 'demo:feedback-1', 'demo:feedback-2')).toEqual({ isAccepted: true, shouldShowDetail: false });
  });

  it('shows the returned detail only while the saved request is still the one displayed', () => {
    expect(findSaveOutcome(true, 'demo:feedback-1', 'demo:feedback-1')).toEqual({ isAccepted: true, shouldShowDetail: true });
  });

  it('reports a failed save as not accepted, whichever feedback is selected', () => {
    expect(findSaveOutcome(false, 'demo:feedback-1', 'demo:feedback-1')).toEqual({ isAccepted: false, shouldShowDetail: false });
    expect(findSaveOutcome(false, 'demo:feedback-1', 'demo:feedback-2')).toEqual({ isAccepted: false, shouldShowDetail: false });
  });

  it('settles only the saved feedback\'s draft after a response that arrives for another selection', () => {
    const storage = createStorage();
    saveReplyDraft(storage, FIRST, 'Sent reply');
    saveReplyDraft(storage, SECOND, 'Still typing');

    const accepted = findSaveOutcome(true, 'demo:feedback-1', 'demo:feedback-2');
    if (accepted.isAccepted) saveReplyDraft(storage, FIRST, '');

    expect(findReplyDraft(storage, FIRST)).toBeNull();
    expect(findReplyDraft(storage, SECOND)).toBe('Still typing');
  });

  it('keeps the draft of a save the server refused', () => {
    const storage = createStorage();
    saveReplyDraft(storage, FIRST, 'Not sent');

    const refused = findSaveOutcome(false, 'demo:feedback-1', 'demo:feedback-2');
    if (refused.isAccepted) saveReplyDraft(storage, FIRST, '');

    expect(findReplyDraft(storage, FIRST)).toBe('Not sent');
  });
});
