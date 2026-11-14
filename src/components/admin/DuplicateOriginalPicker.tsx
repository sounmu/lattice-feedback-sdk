'use client';

import { useState } from 'react';

import { useAdminProjectKey } from '@/hooks/useAdminProjectKey';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useFeedbackList } from '@/hooks/useFeedbackList';
import { filterDuplicateCandidates } from '@/lib/admin-feedback-list';
import { formatDateTime } from '@/lib/feedback-display';
import type { Feedback } from '@/types/feedback';

interface DuplicateOriginalPickerProps {
  feedbackId: string;
  /** Id of the chosen original, or an empty string. */
  value: string;
  disabled: boolean;
  onChange: (originalId: string) => void;
}

const MAX_OPTION_SUMMARY_LENGTH = 40;
const FIELD_CLASS_NAME = 'min-h-11 w-full rounded-[10px] border border-(--admin-border) bg-(--admin-surface) px-3';

function getOptionLabel(feedback: Feedback): string {
  const firstLine = feedback.message.trim().split('\n')[0];
  const summary = firstLine.length > MAX_OPTION_SUMMARY_LENGTH ? `${firstLine.slice(0, MAX_OPTION_SUMMARY_LENGTH)}…` : firstLine;
  return `${formatDateTime(feedback.createdAt)} · ${feedback.reporter.name} · ${summary}`;
}

/** Picks the feedback this one repeats. The project's feedback is loaded only while the picker is shown. */
export function DuplicateOriginalPicker({ feedbackId, value, disabled, onChange }: DuplicateOriginalPickerProps) {
  const projectKey = useAdminProjectKey();
  const token = useAdminToken();
  const { status, items, errorMessage } = useFeedbackList({ projectKey, token });
  const [keyword, setKeyword] = useState('');
  const candidates = filterDuplicateCandidates(items, feedbackId, keyword);
  const selected = items.find((item) => item.id === value);
  // The chosen original stays in the list even when the search no longer matches it.
  const options = selected && !candidates.includes(selected) ? [selected, ...candidates] : candidates;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="duplicate-original-search" className="text-sm font-semibold">
        원본 피드백
      </label>
      <input
        id="duplicate-original-search"
        type="search"
        placeholder="내용, 작성자로 찾기"
        value={keyword}
        disabled={disabled}
        onChange={(event) => setKeyword(event.target.value)}
        className={FIELD_CLASS_NAME}
      />
      <select
        aria-label="원본 피드백 선택"
        value={value}
        disabled={disabled || status !== 'ready'}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_CLASS_NAME}
      >
        <option value="">원본을 선택해 주세요</option>
        {value !== '' && !selected ? <option value={value}>지금 연결된 원본</option> : null}
        {options.map((feedback) => (
          <option key={feedback.id} value={feedback.id}>
            {getOptionLabel(feedback)}
          </option>
        ))}
      </select>
      {status === 'loading' ? (
        <p role="status" className="text-sm text-(--admin-text-sub)">
          피드백 목록을 불러오는 중이에요…
        </p>
      ) : null}
      {status === 'error' || status === 'unauthorized' ? (
        <p role="alert" className="text-sm text-(--admin-danger)">
          {errorMessage}
        </p>
      ) : null}
      {status === 'ready' && options.length === 0 ? (
        <p className="text-sm text-(--admin-text-muted)">{keyword.trim() === '' ? '고를 수 있는 다른 피드백이 없어요.' : '찾는 피드백이 없어요.'}</p>
      ) : null}
    </div>
  );
}
