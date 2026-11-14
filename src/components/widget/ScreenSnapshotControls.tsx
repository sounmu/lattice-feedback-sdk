'use client';

import { useState } from 'react';

import { ScreenSnapshotPreview } from '@/components/widget/ScreenSnapshotPreview';
import type { ScreenSaveStatus } from '@/hooks/useScreenSnapshots';
import { MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK } from '@/lib/feedback-limits';
import type { ScreenCapture, ScreenSnapshotSummary } from '@/types/screen-snapshot';

interface ScreenSnapshotControlsProps {
  snapshots: ScreenSnapshotSummary[];
  /** What each screen was saved from, kept in this browser so it can be looked at before sending. */
  captures: ReadonlyMap<string, ScreenCapture>;
  /** Screens saved automatically for comments and edits; they show where those are on the page. */
  markedScreenIds: ReadonlySet<string>;
  /** Screens holding the replay of a Flow. */
  flowScreenIds: ReadonlySet<string>;
  /** Flow replays whose later part was dropped by the recording limits. */
  truncatedFlowScreenIds: ReadonlySet<string>;
  status: ScreenSaveStatus;
  errorMessage: string | null;
  canCapture: boolean;
  disabled: boolean;
  onCapture: () => void;
  onRemove: (id: string) => void;
}

const STATUS_MESSAGES: Record<ScreenSaveStatus, string> = {
  idle: '지금 보고 있는 화면을 그대로 저장해 함께 보냅니다. 비밀번호 입력값은 저장하지 않습니다.',
  capturing: '화면을 저장하는 중입니다…',
  uploading: '저장한 화면을 올리는 중입니다…',
};

const FLOW_TRUNCATED_MESSAGE = '기록 한도, 페이지 제한 또는 저장 중단으로 흐름의 일부 구간이 누락되었습니다.';

function getSnapshotKind(isMarkedScreen: boolean, isFlowScreen: boolean, isTruncatedFlowScreen: boolean): string {
  if (isTruncatedFlowScreen) {
    return ' · 흐름 재생(뒷부분 잘림)';
  }
  if (isFlowScreen) {
    return ' · 흐름 재생';
  }
  return isMarkedScreen ? ' · 코멘트·편집 위치 포함' : '';
}

function getSnapshotSummary(snapshot: ScreenSnapshotSummary, index: number, kind: string): string {
  const { viewportWidth, viewportHeight } = snapshot.page;
  const time = new Date(snapshot.capturedAt).toLocaleTimeString('ko-KR');
  const summary = `화면 ${index + 1}${kind} · ${viewportWidth}×${viewportHeight} · ${time}`;
  if (snapshot.missingAssets.length === 0) {
    return summary;
  }
  return `${summary} · 글꼴·이미지 ${snapshot.missingAssets.length}개 누락`;
}

export function ScreenSnapshotControls({
  snapshots,
  captures,
  markedScreenIds,
  flowScreenIds,
  truncatedFlowScreenIds,
  status,
  errorMessage,
  canCapture,
  disabled,
  onCapture,
  onRemove,
}: ScreenSnapshotControlsProps) {
  // A removed or replaced screen has no capture any more, which also closes its preview.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewIndex = snapshots.findIndex((snapshot) => snapshot.id === previewId);
  const previewCapture = previewId === null ? undefined : captures.get(previewId);

  function getSummary(snapshot: ScreenSnapshotSummary, index: number): string {
    const { id } = snapshot;
    const kind = getSnapshotKind(markedScreenIds.has(id), flowScreenIds.has(id), truncatedFlowScreenIds.has(id));
    return getSnapshotSummary(snapshot, index, kind);
  }

  return (
    <section aria-label="화면 저장" className="flex w-full min-w-0 flex-col gap-2">
      <button
        type="button"
        className="min-h-11 rounded border px-3 py-2 text-sm disabled:opacity-50"
        disabled={disabled || !canCapture}
        onClick={onCapture}
      >
        현재 화면 저장
      </button>
      <p role="status" aria-live="polite" className="break-words text-xs text-gray-600">
        {STATUS_MESSAGES[status]}
      </p>
      {errorMessage && (
        <p role="alert" className="text-xs text-red-600">
          {errorMessage}
        </p>
      )}
      {truncatedFlowScreenIds.size > 0 && (
        <p role="status" className="break-words text-xs text-amber-700">
          {FLOW_TRUNCATED_MESSAGE}
        </p>
      )}
      {snapshots.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={`저장된 화면 ${snapshots.length}/${MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK}`}>
          {snapshots.map((snapshot, index) => (
            <li key={snapshot.id} className="flex items-start justify-between gap-2 rounded border p-2">
              <span className="min-w-0 flex-1 break-words text-xs">{getSummary(snapshot, index)}</span>
              {captures.has(snapshot.id) && (
                <button
                  type="button"
                  aria-label={`화면 ${index + 1} 미리보기`}
                  aria-pressed={snapshot.id === previewId}
                  className="min-h-11 min-w-11 shrink-0 rounded border px-2 text-xs aria-pressed:bg-gray-900 aria-pressed:text-white"
                  onClick={() => setPreviewId(snapshot.id === previewId ? null : snapshot.id)}
                >
                  미리보기
                </button>
              )}
              <button
                type="button"
                aria-label={`화면 ${index + 1} 삭제`}
                className="min-h-11 min-w-11 shrink-0 rounded border px-2 text-xs disabled:opacity-50"
                disabled={disabled}
                onClick={() => onRemove(snapshot.id)}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
      {previewCapture && previewIndex !== -1 && (
        <ScreenSnapshotPreview
          key={previewId}
          capture={previewCapture}
          title={`화면 ${previewIndex + 1}`}
          onClose={() => setPreviewId(null)}
        />
      )}
    </section>
  );
}
