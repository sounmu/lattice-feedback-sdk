import { describe, expect, it } from 'vitest';

import { countFeedbacksByStatus, DEFAULT_FEEDBACK_LIST_QUERY, filterDuplicateCandidates, filterFeedbacks } from '@/lib/admin-feedback-list';
import { MOCK_FEEDBACKS } from '@/mocks/feedback';
import type { Feedback } from '@/types/feedback';

function createFeedback(overrides: Partial<Feedback> & Pick<Feedback, 'id'>): Feedback {
  return { ...MOCK_FEEDBACKS[0], ...overrides };
}

const OLDEST = createFeedback({ id: 'a', status: 'open', type: 'bug', message: '엑셀 다운로드가 안 돼요', createdAt: '2026-11-11T01:00:00.000Z' });
const MIDDLE = createFeedback({
  id: 'b',
  status: 'in_progress',
  type: 'question',
  message: '필터 의미가 궁금해요',
  reporter: { id: 'user_9', name: '김래티스', email: 'kim@example.com' },
  createdAt: '2026-11-12T01:00:00.000Z',
});
const NEWEST = createFeedback({
  id: 'c',
  status: 'resolved',
  type: 'improvement',
  message: '저장 버튼을 위로 옮겨 주세요',
  adminReply: '다음 배포에 반영할게요',
  createdAt: '2026-11-13T01:00:00.000Z',
});
const ITEMS = [MIDDLE, NEWEST, OLDEST];

function getIds(items: Feedback[]): string[] {
  return items.map((item) => item.id);
}

describe('filterFeedbacks', () => {
  it('sorts newest first by default', () => {
    expect(getIds(filterFeedbacks(ITEMS, DEFAULT_FEEDBACK_LIST_QUERY))).toEqual(['c', 'b', 'a']);
  });

  it('sorts oldest first when asked', () => {
    expect(getIds(filterFeedbacks(ITEMS, { ...DEFAULT_FEEDBACK_LIST_QUERY, sortOrder: 'oldest' }))).toEqual(['a', 'b', 'c']);
  });

  it('does not change the input order', () => {
    filterFeedbacks(ITEMS, DEFAULT_FEEDBACK_LIST_QUERY);

    expect(getIds(ITEMS)).toEqual(['b', 'c', 'a']);
  });

  it('filters by status', () => {
    expect(getIds(filterFeedbacks(ITEMS, { ...DEFAULT_FEEDBACK_LIST_QUERY, status: 'in_progress' }))).toEqual(['b']);
  });

  it('filters by type', () => {
    expect(getIds(filterFeedbacks(ITEMS, { ...DEFAULT_FEEDBACK_LIST_QUERY, type: 'improvement' }))).toEqual(['c']);
  });

  it('matches the keyword in the message, the reporter and the admin reply', () => {
    expect(getIds(filterFeedbacks(ITEMS, { ...DEFAULT_FEEDBACK_LIST_QUERY, keyword: '엑셀' }))).toEqual(['a']);
    expect(getIds(filterFeedbacks(ITEMS, { ...DEFAULT_FEEDBACK_LIST_QUERY, keyword: '김래티스' }))).toEqual(['b']);
    expect(getIds(filterFeedbacks(ITEMS, { ...DEFAULT_FEEDBACK_LIST_QUERY, keyword: '다음 배포' }))).toEqual(['c']);
  });

  it('ignores case and surrounding spaces in the keyword', () => {
    expect(getIds(filterFeedbacks(ITEMS, { ...DEFAULT_FEEDBACK_LIST_QUERY, keyword: '  KIM@EXAMPLE.COM ' }))).toEqual(['b']);
  });

  it('combines the filters', () => {
    const query = { ...DEFAULT_FEEDBACK_LIST_QUERY, status: 'open', type: 'question' } as const;

    expect(filterFeedbacks(ITEMS, query)).toEqual([]);
  });
});

describe('filterDuplicateCandidates', () => {
  it('offers every other feedback that is not itself a duplicate, newest first, narrowed by the keyword', () => {
    const duplicate = createFeedback({ id: 'd', status: 'duplicate', duplicateOfId: 'a', createdAt: '2026-11-14T01:00:00.000Z' });
    const items = [...ITEMS, duplicate];

    expect(getIds(filterDuplicateCandidates(items, 'b', ''))).toEqual(['c', 'a']);
    expect(getIds(filterDuplicateCandidates(items, 'b', '엑셀'))).toEqual(['a']);
  });
});

describe('countFeedbacksByStatus', () => {
  it('counts every status and the total', () => {
    expect(countFeedbacksByStatus(ITEMS)).toEqual({ all: 3, open: 1, in_progress: 1, resolved: 1, rejected: 0, duplicate: 0 });
  });

  it('returns zeros for an empty list', () => {
    expect(countFeedbacksByStatus([])).toEqual({ all: 0, open: 0, in_progress: 0, resolved: 0, rejected: 0, duplicate: 0 });
  });
});
