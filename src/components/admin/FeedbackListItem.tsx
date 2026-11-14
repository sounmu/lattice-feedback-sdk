import Link from 'next/link';
import type { MouseEvent } from 'react';

import { StatusBadge, TypeBadge } from '@/components/admin/FeedbackBadges';
import { formatRelativeTime, getPagePath, summarizeAttachments } from '@/lib/feedback-display';
import type { Feedback } from '@/types/feedback';

interface FeedbackListItemProps {
  feedback: Feedback;
  projectKey: string;
  nowTimestamp: number;
  isSelected: boolean;
  /** Given when a click should open the feedback next to the list instead of following the link. */
  onSelect?: (id: string) => void;
}

export function FeedbackListItem({ feedback, projectKey, nowTimestamp, isSelected, onSelect }: FeedbackListItemProps) {
  const attachmentSummary = summarizeAttachments(feedback.attachments);
  const href = `/admin/feedback/${encodeURIComponent(feedback.id)}?projectKey=${encodeURIComponent(projectKey)}`;

  const stateClassName = isSelected
    ? 'border-(--admin-primary) bg-(--admin-primary-weak)'
    : 'border-(--admin-border) bg-(--admin-surface) hover:border-(--admin-primary)';

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click keeps its browser meaning, such as opening the feedback in a new tab.
    if (!onSelect || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onSelect(feedback.id);
  }

  return (
    <li>
      <Link
        href={href}
        onClick={handleClick}
        aria-current={isSelected ? 'true' : undefined}
        className={`flex flex-col gap-2 rounded-2xl border p-4 ${stateClassName}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={feedback.status} />
          <TypeBadge type={feedback.type} />
          <span className="ml-auto text-xs text-(--admin-text-muted)">{formatRelativeTime(feedback.createdAt, nowTimestamp)}</span>
        </div>
        <p className="line-clamp-2 font-medium">{feedback.message}</p>
        <div className="flex flex-wrap gap-x-3 text-xs text-(--admin-text-sub)">
          <span>{feedback.reporter.name}</span>
          <span>{getPagePath(feedback.page.url)}</span>
          {attachmentSummary.map((item) => (
            <span key={item.kind} className="text-(--admin-primary)">
              {item.label}
            </span>
          ))}
          {feedback.adminReply ? <span className="text-(--admin-success)">답변 완료</span> : null}
        </div>
      </Link>
    </li>
  );
}
