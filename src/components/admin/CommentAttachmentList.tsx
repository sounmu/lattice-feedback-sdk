import { getElementLabel } from '@/lib/feedback-display';
import type { CommentAttachment } from '@/types/feedback';

export function CommentAttachmentList({ comments }: { comments: CommentAttachment[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {comments.map((item, index) => (
        <li key={`${item.target.selector}-${index}`} className="flex gap-3 rounded-(--radius-container) bg-(--admin-surface-sub) p-3">
          <span className="widget-mark-number shrink-0">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p>{item.comment}</p>
            <p className="mt-1 truncate font-mono text-xs text-(--admin-text-muted)">{getElementLabel(item.target)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
