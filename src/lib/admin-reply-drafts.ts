// A reply the admin typed but has not saved yet, kept per feedback so moving to another feedback does not
// lose it. It lives in sessionStorage, like the admin token, so it disappears when the tab closes.
import type { Feedback } from '@/types/feedback';

const REPLY_DRAFT_KEY_PREFIX = 'lattice-feedback:admin-reply-draft:';

type DraftFeedback = Pick<Feedback, 'id' | 'projectKey' | 'adminReply'>;

/** The part of browser storage the drafts use. window.sessionStorage fits. */
export type ReplyDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface StoredReplyDraft {
  /** The saved reply the draft was written over. */
  savedReply: string;
  reply: string;
}

function getDraftKey(feedback: DraftFeedback): string {
  return `${REPLY_DRAFT_KEY_PREFIX}${feedback.projectKey}:${feedback.id}`;
}

function findStoredDraft(value: string | null): StoredReplyDraft | null {
  if (value === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Not written by this module.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('savedReply' in parsed) || !('reply' in parsed)) {
    return null;
  }
  if (typeof parsed.savedReply !== 'string' || typeof parsed.reply !== 'string') {
    return null;
  }
  return { savedReply: parsed.savedReply, reply: parsed.reply };
}

/** The unsaved reply for a feedback, or null. A draft written over a reply that has changed since is dropped. */
export function findReplyDraft(storage: ReplyDraftStorage, feedback: DraftFeedback): string | null {
  const key = getDraftKey(feedback);
  const stored = findStoredDraft(storage.getItem(key));
  if (stored === null) {
    return null;
  }
  if (stored.savedReply !== (feedback.adminReply ?? '')) {
    storage.removeItem(key);
    return null;
  }
  return stored.reply;
}

/** Keeps the reply as a draft, or clears the draft when the reply matches what is saved. */
export function saveReplyDraft(storage: ReplyDraftStorage, feedback: DraftFeedback, reply: string): void {
  const key = getDraftKey(feedback);
  const savedReply = feedback.adminReply ?? '';
  if (reply.trim() === savedReply) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify({ savedReply, reply }));
}

/** The draft kept in this tab, or null. Storage can be blocked; there is then no draft to bring back. */
export function findBrowserReplyDraft(feedback: DraftFeedback): string | null {
  try {
    return findReplyDraft(window.sessionStorage, feedback);
  } catch {
    return null;
  }
}

/** Keeps the draft in this tab. Returns false when storage is blocked or full, so the draft is not kept. */
export function saveBrowserReplyDraft(feedback: DraftFeedback, reply: string): boolean {
  try {
    saveReplyDraft(window.sessionStorage, feedback, reply);
    return true;
  } catch {
    return false;
  }
}
