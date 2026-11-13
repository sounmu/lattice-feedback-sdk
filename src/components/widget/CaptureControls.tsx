'use client';

import { useState } from 'react';

import { MAX_COMMENT_LENGTH, MAX_COMMENTS, MAX_EDITS } from '@/lib/feedback-limits';
import type { EditAttachment, ElementTarget, FlowEventType } from '@/types/feedback';
import type { AttachmentKind, CaptureMode, CaptureState } from '@/types/sdk-message';

interface CaptureControlsProps extends Pick<CaptureState, 'attachments' | 'activeMode' | 'selection' | 'enabled'> {
  disabled: boolean;
  onStart: (mode: CaptureMode) => void;
  onCancel: () => void;
  onStopFlow: () => void;
  onAddComment: (comment: string) => void;
  onRemove: (kind: AttachmentKind, index: number) => void;
}

const MAX_TARGET_LABEL_LENGTH = 60;
const MAX_FLOW_LABELS = 5;

const MODE_LABELS: Record<CaptureMode, string> = {
  comment: '요소 코멘트',
  edit: '위치 편집',
  flow: '흐름 기록',
};

const MODE_STATUS: Record<CaptureMode, string> = {
  comment: '페이지에서 코멘트할 요소를 클릭하세요.',
  edit: '페이지에서 요소를 끌어 원하는 위치를 보여주세요.',
  flow: '흐름 기록 중: 클릭, 화면 이동, 입력 발생 여부만 기록합니다. 입력값은 수집하지 않습니다.',
};

const FLOW_EVENT_LABELS: Record<FlowEventType, string> = {
  click: '클릭',
  navigation: '화면 이동',
  input: '입력',
};

const MODES: CaptureMode[] = ['comment', 'edit', 'flow'];

const BUTTON_CLASS = 'min-h-11 rounded border px-3 py-2 text-sm disabled:opacity-50';
const ATTACHMENT_LABELS: Record<AttachmentKind, string> = { comments: '코멘트', edits: '위치 편집', flow: '흐름 기록' };

function getTargetLabel(target: Pick<ElementTarget, 'feedbackId' | 'tagName'>): string {
  const label = target.feedbackId ?? target.tagName.toLowerCase();
  if (label.length <= MAX_TARGET_LABEL_LENGTH) {
    return label;
  }
  return `${label.slice(0, MAX_TARGET_LABEL_LENGTH)}…`;
}

function getEditSummary(edit: EditAttachment): string {
  const deltaX = Math.round(edit.proposedRect.x - edit.originalRect.x);
  const deltaY = Math.round(edit.proposedRect.y - edit.originalRect.y);
  return `${getTargetLabel(edit.target)} (가로 ${deltaX}px, 세로 ${deltaY}px 이동)`;
}

export function CaptureControls({
  attachments,
  activeMode,
  selection,
  enabled,
  disabled,
  onStart,
  onCancel,
  onStopFlow,
  onAddComment,
  onRemove,
}: CaptureControlsProps) {
  const [commentDraft, setCommentDraft] = useState('');
  const selectionKey = selection ? `${selection.feedbackId ?? selection.tagName}:${selection.selector}` : null;
  const [draftSelection, setDraftSelection] = useState(selectionKey);

  // A draft belongs to the element it was written for: drop it when the selection changes.
  if (draftSelection !== selectionKey) {
    setDraftSelection(selectionKey);
    setCommentDraft('');
  }

  const isCommentFull = attachments.comments.length >= MAX_COMMENTS;
  const isEditFull = attachments.edits.length >= MAX_EDITS;
  const hasFlow = attachments.flow !== null;
  const trimmedDraft = commentDraft.trim();
  const canAttachComment = !disabled && !isCommentFull && trimmedDraft.length > 0;

  function findStartBlocker(mode: CaptureMode): string | null {
    if (mode === 'comment' && isCommentFull) {
      return `코멘트는 최대 ${MAX_COMMENTS}개까지 첨부할 수 있습니다.`;
    }
    if (mode === 'edit' && isEditFull) {
      return `위치 편집은 최대 ${MAX_EDITS}개까지 첨부할 수 있습니다.`;
    }
    if (mode === 'flow' && hasFlow) {
      return '흐름 기록은 1개만 첨부할 수 있습니다. 기존 기록을 삭제한 뒤 다시 시작하세요.';
    }
    return null;
  }

  function handleAttachComment() {
    if (!canAttachComment) {
      return;
    }
    onAddComment(trimmedDraft);
    setCommentDraft('');
  }

  function handleCancel() {
    setCommentDraft('');
    onCancel();
  }

  function renderStatus() {
    if (!enabled) {
      return '이 페이지에서는 화면 맥락 첨부가 허용되지 않습니다. 텍스트만으로도 보낼 수 있습니다.';
    }
    if (activeMode === null) {
      return '필요하면 화면 맥락을 첨부하세요. 여러 모드를 함께 사용할 수 있습니다.';
    }
    if (activeMode === 'comment' && selection) {
      return `선택한 요소: ${getTargetLabel(selection)}`;
    }
    return MODE_STATUS[activeMode];
  }

  function renderCommentForm() {
    if (activeMode !== 'comment' || !selection) {
      return null;
    }
    return (
      <div className="flex flex-col gap-2">
        <label className="text-xs text-gray-600" htmlFor="capture-comment">
          {getTargetLabel(selection)}에 대한 코멘트 ({commentDraft.length}/{MAX_COMMENT_LENGTH})
        </label>
        <textarea
          id="capture-comment"
          autoFocus
          className="min-h-20 w-full rounded border p-2 text-sm"
          value={commentDraft}
          maxLength={MAX_COMMENT_LENGTH}
          disabled={disabled}
          onChange={(event) => setCommentDraft(event.target.value)}
        />
        <button type="button" className={BUTTON_CLASS} disabled={!canAttachComment} onClick={handleAttachComment}>
          코멘트 첨부
        </button>
      </div>
    );
  }

  function renderActiveControls() {
    if (activeMode === null) {
      return null;
    }
    return (
      <div className="flex flex-wrap gap-2">
        {activeMode === 'flow' && (
          <button type="button" className={BUTTON_CLASS} disabled={disabled} onClick={onStopFlow}>
            기록 종료 및 첨부
          </button>
        )}
        <button type="button" className={BUTTON_CLASS} onClick={handleCancel}>
          {MODE_LABELS[activeMode]} 취소
        </button>
      </div>
    );
  }

  function renderAttachmentItem(summary: string, kind: AttachmentKind, index: number) {
    const label = kind === 'flow' ? ATTACHMENT_LABELS[kind] : `${ATTACHMENT_LABELS[kind]} ${index + 1}`;
    return (
      <li key={`${kind}-${index}`} className="flex items-start justify-between gap-2 rounded border p-2">
        <span className="min-w-0 break-words text-xs">{summary}</span>
        <button
          type="button"
          aria-label={`${label} 삭제`}
          className="min-h-11 min-w-11 shrink-0 rounded border px-2 text-xs disabled:opacity-50"
          disabled={disabled}
          onClick={() => onRemove(kind, index)}
        >
          삭제
        </button>
      </li>
    );
  }

  function renderFlowSummary(): string {
    const events = attachments.flow?.events ?? [];
    const labels = events.slice(0, MAX_FLOW_LABELS).map((event) => FLOW_EVENT_LABELS[event.type]);
    const sequence = events.length > MAX_FLOW_LABELS ? `${labels.join(' → ')} → …` : labels.join(' → ');
    return `흐름 기록 · 이벤트 ${events.length}개${sequence ? ` · ${sequence}` : ''}`;
  }

  const startBlockers = MODES.map(findStartBlocker).filter((blocker): blocker is string => blocker !== null);

  return (
    <section aria-label="화면 맥락 첨부" className="flex w-full min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={activeMode === mode}
            className={BUTTON_CLASS}
            disabled={disabled || !enabled || activeMode !== null || findStartBlocker(mode) !== null}
            onClick={() => onStart(mode)}
          >
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="break-words text-xs text-gray-600">
        {renderStatus()}
      </p>
      {enabled && startBlockers.map((blocker) => (
        <p key={blocker} className="text-xs text-amber-700">
          {blocker}
        </p>
      ))}
      {renderCommentForm()}
      {renderActiveControls()}
      <p className="text-xs text-gray-500">
        코멘트 {attachments.comments.length}/{MAX_COMMENTS} · 위치 편집 {attachments.edits.length}/{MAX_EDITS} · 흐름{' '}
        {hasFlow ? 1 : 0}/1
      </p>
      <ul className="flex flex-col gap-2" aria-label="첨부된 맥락">
        {attachments.comments.map((comment, index) =>
          renderAttachmentItem(
            `코멘트 · ${getTargetLabel(comment.target)}: ${comment.comment}`,
            'comments',
            index,
          ),
        )}
        {attachments.edits.map((edit, index) =>
          renderAttachmentItem(`위치 편집 · ${getEditSummary(edit)}`, 'edits', index),
        )}
        {hasFlow && renderAttachmentItem(renderFlowSummary(), 'flow', 0)}
      </ul>
    </section>
  );
}
