import { getElementLabel } from '@/lib/feedback-display';
import type { CommentAttachment } from '@/types/feedback';

export function CommentAttachmentList({ comments }: { comments: CommentAttachment[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {comments.map((item, index) => (
        <li key={`${item.target.selector}-${index}`} className="flex gap-3 rounded-xl bg-(--admin-surface-sub) p-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-(--admin-primary) text-xs font-bold text-white">
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
