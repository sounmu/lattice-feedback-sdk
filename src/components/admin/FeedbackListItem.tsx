import Link from 'next/link';

import { StatusBadge, TypeBadge } from '@/components/admin/FeedbackBadges';
import { formatRelativeTime, getPagePath, summarizeAttachments } from '@/lib/feedback-display';
import type { Feedback } from '@/types/feedback';

interface FeedbackListItemProps {
  feedback: Feedback;
  projectKey: string;
  nowTimestamp: number;
}

export function FeedbackListItem({ feedback, projectKey, nowTimestamp }: FeedbackListItemProps) {
  const attachmentSummary = summarizeAttachments(feedback.attachments);
  const href = `/admin/feedback/${encodeURIComponent(feedback.id)}?projectKey=${encodeURIComponent(projectKey)}`;

  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-2 rounded-2xl border border-(--admin-border) bg-(--admin-surface) p-4 hover:border-(--admin-primary)"
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
