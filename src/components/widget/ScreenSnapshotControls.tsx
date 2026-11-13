'use client';

import type { ScreenSaveStatus } from '@/hooks/useScreenSnapshots';
import { MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK } from '@/lib/feedback-limits';
import type { ScreenSnapshotSummary } from '@/types/screen-snapshot';

interface ScreenSnapshotControlsProps {
  snapshots: ScreenSnapshotSummary[];
  /** Screens saved automatically for comments; they show the comment pins. */
  commentScreenIds: ReadonlySet<string>;
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

function getSnapshotSummary(snapshot: ScreenSnapshotSummary, index: number, isCommentScreen: boolean): string {
  const { viewportWidth, viewportHeight } = snapshot.page;
  const time = new Date(snapshot.capturedAt).toLocaleTimeString('ko-KR');
  const kind = isCommentScreen ? ' · 코멘트 위치 포함' : '';
  const summary = `화면 ${index + 1}${kind} · ${viewportWidth}×${viewportHeight} · ${time}`;
  if (snapshot.missingAssets.length === 0) {
    return summary;
  }
  return `${summary} · 글꼴·이미지 ${snapshot.missingAssets.length}개 누락`;
}

export function ScreenSnapshotControls({
  snapshots,
  commentScreenIds,
  status,
  errorMessage,
  canCapture,
  disabled,
  onCapture,
  onRemove,
}: ScreenSnapshotControlsProps) {
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
      {snapshots.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={`저장된 화면 ${snapshots.length}/${MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK}`}>
          {snapshots.map((snapshot, index) => (
            <li key={snapshot.id} className="flex items-start justify-between gap-2 rounded border p-2">
              <span className="min-w-0 break-words text-xs">{getSnapshotSummary(snapshot, index, commentScreenIds.has(snapshot.id))}</span>
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
