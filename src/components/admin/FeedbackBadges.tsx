import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from '@/lib/feedback-display';
import type { FeedbackStatus, FeedbackType } from '@/types/feedback';

const STATUS_CLASS_NAMES: Record<FeedbackStatus, string> = {
  open: 'bg-(--admin-warning-weak) text-(--admin-warning)',
  in_progress: 'bg-(--admin-primary-weak) text-(--admin-primary)',
  resolved: 'bg-(--admin-success-weak) text-(--admin-success)',
  rejected: 'bg-(--admin-surface-sub) text-(--admin-text-sub)',
  duplicate: 'bg-(--admin-surface-sub) text-(--admin-text-sub)',
};

const TYPE_CLASS_NAMES: Record<FeedbackType, string> = {
  bug: 'bg-(--admin-danger-weak) text-(--admin-danger)',
  improvement: 'bg-(--admin-surface-sub) text-(--admin-text-sub)',
  question: 'bg-(--admin-surface-sub) text-(--admin-text-sub)',
  other: 'bg-(--admin-surface-sub) text-(--admin-text-sub)',
};

const BADGE_CLASS_NAME = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold';

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  return <span className={`${BADGE_CLASS_NAME} ${STATUS_CLASS_NAMES[status]}`}>{FEEDBACK_STATUS_LABELS[status]}</span>;
}

export function TypeBadge({ type }: { type: FeedbackType }) {
  return <span className={`${BADGE_CLASS_NAME} ${TYPE_CLASS_NAMES[type]}`}>{FEEDBACK_TYPE_LABELS[type]}</span>;
}
