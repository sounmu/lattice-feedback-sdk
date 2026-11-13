'use client';

import type { ScreenSaveStatus } from '@/hooks/useScreenSnapshots';
import { MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK } from '@/lib/feedback-limits';
import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

interface ScreenSnapshotControlsProps {
  snapshots: ScreenSnapshotSummary[];
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

const FLOW_TRUNCATED_MESSAGE = '흐름 기록이 한도를 넘었거나 저장할 수 없는 페이지로 이동해 뒷부분은 재생에 포함되지 않았습니다.';

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
              <span className="min-w-0 break-words text-xs">{getSummary(snapshot, index)}</span>
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
    </section>
  );
}
