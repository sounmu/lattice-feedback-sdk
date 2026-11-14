import type { ElementTarget, FeedbackAttachments, FeedbackStatus, FeedbackType } from '@/types/feedback';

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: '버그',
  improvement: '개선 제안',
  question: '질문',
  other: '기타',
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: '접수',
  in_progress: '진행 중',
  resolved: '완료',
  rejected: '반려',
  duplicate: '중복',
};

export const FEEDBACK_TYPES: FeedbackType[] = ['bug', 'improvement', 'question', 'other'];
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['open', 'in_progress', 'resolved', 'rejected', 'duplicate'];

const KOREA_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_TIME_LIMIT_DAYS = 7;

function padTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** Korea time, independent of the viewer's time zone: 2026.11.13 23:28 */
export function formatDateTime(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) {
    return isoTimestamp;
  }
  const date = new Date(timestamp + KOREA_UTC_OFFSET_MS);
  const day = `${date.getUTCFullYear()}.${padTwoDigits(date.getUTCMonth() + 1)}.${padTwoDigits(date.getUTCDate())}`;
  const time = `${padTwoDigits(date.getUTCHours())}:${padTwoDigits(date.getUTCMinutes())}`;
  return `${day} ${time}`;
}

export function formatRelativeTime(isoTimestamp: string, nowTimestamp: number): string {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) {
    return isoTimestamp;
  }
  const elapsed = nowTimestamp - timestamp;
  if (elapsed < MINUTE_MS) {
    return '방금 전';
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}분 전`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}시간 전`;
  }
  if (elapsed < RELATIVE_TIME_LIMIT_DAYS * DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)}일 전`;
  }
  return formatDateTime(isoTimestamp);
}

/** Position in a Flow recording: 1:05.3 */
export function formatOffset(offsetMs: number): string {
  const totalSeconds = Math.max(offsetMs, 0) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}

export function getPagePath(pageUrl: string): string {
  try {
    return new URL(pageUrl).pathname;
  } catch {
    return pageUrl;
  }
}

export function getElementLabel(target: ElementTarget): string {
  return target.feedbackId ?? target.selector;
}

export type AttachmentKind = 'comment' | 'edit' | 'flow';

export interface AttachmentSummaryItem {
  kind: AttachmentKind;
  label: string;
}

/** Only attachment kinds the reporter actually used. */
export function summarizeAttachments(attachments: FeedbackAttachments): AttachmentSummaryItem[] {
  const items: AttachmentSummaryItem[] = [];
  if (attachments.comments.length > 0) {
    items.push({ kind: 'comment', label: `코멘트 ${attachments.comments.length}` });
  }
  if (attachments.edits.length > 0) {
    items.push({ kind: 'edit', label: `위치 편집 ${attachments.edits.length}` });
  }
  if (attachments.flow !== null) {
    items.push({ kind: 'flow', label: `흐름 ${attachments.flow.events.length}개` });
  }
  return items;
}
