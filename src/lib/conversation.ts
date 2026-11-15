import type { ConversationAccess, ConversationCredentials, ConversationMessage } from '@/types/conversation';
import type { Feedback } from '@/types/feedback';

export const MAX_THREAD_MESSAGES = 100;
export const MAX_THREAD_MESSAGE_LENGTH = 5000;
// The id the widget submits under when the host page has not called setUser.
export const ANONYMOUS_REPORTER_ID = 'anonymous';

export class ConversationLimitError extends Error {
  constructor() {
    super('Conversation message limit reached.');
    this.name = 'ConversationLimitError';
  }
}

export function canReadConversation(access: ConversationAccess | undefined, credentials: ConversationCredentials): boolean {
  return access !== undefined && (
    credentials.browserSecretHashes.includes(access.browserSecretHash) ||
    (access.verifiedReporterId !== null && access.verifiedReporterId === credentials.verifiedReporterId)
  );
}

// A capability only opens the conversation for the reporter it was issued to. Presenting it with another
// reporter id means the browser's user changed, so the request is refused even though the secret is valid.
export function canPresentReporter(feedback: Pick<Feedback, 'reporter'>, presentedReporter: { id: string } | null): boolean {
  return feedback.reporter.id === (presentedReporter?.id ?? ANONYMOUS_REPORTER_ID);
}

export function getFollowupMessages(feedback: Feedback): ConversationMessage[] {
  if (feedback.messages !== undefined) return feedback.messages;
  if (!feedback.adminReply) return [];
  return [{ id: `${feedback.id}:legacy`, authorRole: 'admin', body: feedback.adminReply, createdAt: feedback.updatedAt }];
}

export function getConversationMessages(feedback: Feedback): ConversationMessage[] {
  return [
    { id: feedback.id, authorRole: 'reporter', body: feedback.message, createdAt: feedback.createdAt },
    ...getFollowupMessages(feedback),
  ];
}

export function appendConversationMessage(feedback: Feedback, message: Pick<ConversationMessage, 'authorRole' | 'body'>): ConversationMessage[] {
  const messages = getFollowupMessages(feedback);
  if (messages.length + 1 >= MAX_THREAD_MESSAGES || !message.body.trim() || message.body.length > MAX_THREAD_MESSAGE_LENGTH) {
    throw new ConversationLimitError();
  }
  return [...messages, { ...message, id: crypto.randomUUID(), createdAt: new Date().toISOString() }];
}
