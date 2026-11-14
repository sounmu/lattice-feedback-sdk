'use client';

import { useState } from 'react';

import { FeedbackListItem } from '@/components/admin/FeedbackListItem';
import {
  countFeedbacksByStatus,
  DEFAULT_FEEDBACK_LIST_QUERY,
  filterFeedbacks,
  type FeedbackListQuery,
  type SortOrder,
  type StatusFilter,
  type TypeFilter,
} from '@/lib/admin-feedback-list';
import { FEEDBACK_STATUS_LABELS, FEEDBACK_STATUSES, FEEDBACK_TYPE_LABELS, FEEDBACK_TYPES } from '@/lib/feedback-display';
import type { Feedback } from '@/types/feedback';

interface FeedbackListViewProps {
  items: Feedback[];
  projectKey: string;
  nowTimestamp: number;
  onReload: () => void;
}

const STATUS_TABS: StatusFilter[] = ['all', ...FEEDBACK_STATUSES];
const FIELD_CLASS_NAME = 'min-h-11 rounded-[10px] border border-(--admin-border) bg-(--admin-surface) px-3';

function getStatusTabLabel(status: StatusFilter): string {
  return status === 'all' ? '전체' : FEEDBACK_STATUS_LABELS[status];
}

export function FeedbackListView({ items, projectKey, nowTimestamp, onReload }: FeedbackListViewProps) {
  const [query, setQuery] = useState<FeedbackListQuery>(DEFAULT_FEEDBACK_LIST_QUERY);
  const counts = countFeedbacksByStatus(items);
  const visibleItems = filterFeedbacks(items, query);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">받은 피드백</h1>
        <button type="button" onClick={onReload} className={`${FIELD_CLASS_NAME} text-(--admin-text-sub)`}>
          새로고침
        </button>
      </div>

      <div role="tablist" aria-label="상태별 보기" className="flex flex-wrap gap-2">
        {STATUS_TABS.map((status) => {
          const isSelected = query.status === status;
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setQuery({ ...query, status })}
              className={`min-h-11 rounded-full px-4 font-semibold ${
                isSelected ? 'bg-(--admin-primary) text-white' : 'border border-(--admin-border) bg-(--admin-surface) text-(--admin-text-sub)'
              }`}
            >
              {getStatusTabLabel(status)} {counts[status]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="피드백 검색"
          placeholder="내용, 작성자, 페이지 검색"
          value={query.keyword}
          onChange={(event) => setQuery({ ...query, keyword: event.target.value })}
          className={`${FIELD_CLASS_NAME} min-w-56 flex-1`}
        />
        <select
          aria-label="유형 필터"
          value={query.type}
          onChange={(event) => setQuery({ ...query, type: event.target.value as TypeFilter })}
          className={FIELD_CLASS_NAME}
        >
          <option value="all">모든 유형</option>
          {FEEDBACK_TYPES.map((type) => (
            <option key={type} value={type}>
              {FEEDBACK_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <select
          aria-label="정렬"
          value={query.sortOrder}
          onChange={(event) => setQuery({ ...query, sortOrder: event.target.value as SortOrder })}
          className={FIELD_CLASS_NAME}
        >
          <option value="newest">최신순</option>
          <option value="oldest">오래된 순</option>
        </select>
      </div>

      {visibleItems.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-(--admin-border) p-8 text-center text-(--admin-text-muted)">
          {items.length === 0 ? '아직 받은 피드백이 없어요.' : '조건에 맞는 피드백이 없어요.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleItems.map((feedback) => (
            <FeedbackListItem key={feedback.id} feedback={feedback} projectKey={projectKey} nowTimestamp={nowTimestamp} />
          ))}
        </ul>
      )}
    </section>
  );
}
