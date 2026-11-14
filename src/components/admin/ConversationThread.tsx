import { getConversationMessages } from '@/lib/conversation';
import { formatDateTime } from '@/lib/feedback-display';
import type { ConversationMessage } from '@/types/conversation';
import type { Feedback } from '@/types/feedback';

export const AUTHOR_LABELS: Record<ConversationMessage['authorRole'], string> = {
  reporter: '작성자', admin: '담당자', sdk: 'SDK 관찰', ai: 'AI 생성',
};

export function ConversationThread({ feedback }: { feedback: Feedback }) {
  return (
    <section aria-label="대화 내역" className="min-w-0">
      <h3 className="mb-3 font-semibold">대화 내역</h3>
      <ol className="flex flex-col gap-4">
        {getConversationMessages(feedback).map((message) => (
          <li key={message.id} className="min-w-0 border-b border-(--admin-border) pb-3">
            <p className="text-sm font-semibold">{AUTHOR_LABELS[message.authorRole]}</p>
            <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{message.body}</p>
            <time dateTime={message.createdAt} className="text-xs text-(--admin-text-muted)">{formatDateTime(message.createdAt)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
