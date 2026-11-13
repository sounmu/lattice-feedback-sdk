import type { Feedback, FeedbackStatus, FeedbackType } from '@/types/feedback';

export type StatusFilter = FeedbackStatus | 'all';
export type TypeFilter = FeedbackType | 'all';
export type SortOrder = 'newest' | 'oldest';

export interface FeedbackListQuery {
  status: StatusFilter;
  type: TypeFilter;
  keyword: string;
  sortOrder: SortOrder;
}

export const DEFAULT_FEEDBACK_LIST_QUERY: FeedbackListQuery = {
  status: 'all',
  type: 'all',
  keyword: '',
  sortOrder: 'newest',
};

function getSearchableText(feedback: Feedback): string {
  const parts = [
    feedback.message,
    feedback.reporter.name,
    feedback.reporter.email ?? '',
    feedback.reporter.id,
    feedback.page.title,
    feedback.page.url,
    feedback.adminReply ?? '',
  ];
  return parts.join('\n').toLowerCase();
}

function matchesKeyword(feedback: Feedback, keyword: string): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (normalizedKeyword === '') {
    return true;
  }
  return getSearchableText(feedback).includes(normalizedKeyword);
}

function compareByCreatedAt(first: Feedback, second: Feedback): number {
  return Date.parse(first.createdAt) - Date.parse(second.createdAt);
}

export function filterFeedbacks(items: Feedback[], query: FeedbackListQuery): Feedback[] {
  const filtered = items.filter((feedback) => {
    if (query.status !== 'all' && feedback.status !== query.status) {
      return false;
    }
    if (query.type !== 'all' && feedback.type !== query.type) {
      return false;
    }
    return matchesKeyword(feedback, query.keyword);
  });
  const sorted = [...filtered].sort(compareByCreatedAt);
  if (query.sortOrder === 'newest') {
    sorted.reverse();
  }
  return sorted;
}

export type FeedbackStatusCounts = Record<StatusFilter, number>;

export function countFeedbacksByStatus(items: Feedback[]): FeedbackStatusCounts {
  const counts: FeedbackStatusCounts = { all: items.length, open: 0, in_progress: 0, resolved: 0 };
  for (const feedback of items) {
    counts[feedback.status] += 1;
  }
  return counts;
}
