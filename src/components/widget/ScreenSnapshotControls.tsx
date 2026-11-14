'use client';

import { useState } from 'react';

import { ScreenSnapshotPreview } from '@/components/widget/ScreenSnapshotPreview';
import { CameraIcon } from '@/components/widget/WidgetIcons';
import { AttachmentCard } from '@/components/widget/WidgetLayout';
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
  disabled: boolean;
  onRemove: (id: string) => void;
}

interface ScreenCardText {
  title: string;
  /** Why the screen was saved, when it was saved automatically. */
  origin: string | null;
}

function getScreenCardText(index: number, isMarked: boolean, isFlow: boolean, isTruncatedFlow: boolean): ScreenCardText {
  const title = `저장한 화면 ${index + 1}`;
  if (isTruncatedFlow) {
    return { title: `${title} · 흐름 재생(뒷부분 잘림)`, origin: '흐름 기록을 마칠 때 자동으로 저장됐어요' };
  }
  if (isFlow) {
    return { title: `${title} · 흐름 재생`, origin: '흐름 기록을 마칠 때 자동으로 저장됐어요' };
  }
  if (isMarked) {
    return { title: `${title} · 코멘트·편집 위치 포함`, origin: '코멘트·편집 위치를 표시하려고 자동으로 저장됐어요' };
  }
  return { title, origin: null };
}

function getScreenDescription(snapshot: ScreenSnapshotSummary, origin: string | null): string {
  const { viewportWidth, viewportHeight } = snapshot.page;
  const time = new Date(snapshot.capturedAt).toLocaleTimeString('ko-KR');
  const parts = [`${viewportWidth}×${viewportHeight}`, time];
  if (origin) {
    parts.unshift(origin);
  }
  if (snapshot.missingAssets.length > 0) {
    parts.push(`가림·누락 기록 ${snapshot.missingAssets.length}개`);
  }
  return parts.join(' · ');
}

/** Cards for the saved screens, after the comment, edit and Flow cards, plus the preview of one of them. */
export function ScreenSnapshotControls({
  snapshots,
  captures,
  markedScreenIds,
  flowScreenIds,
  truncatedFlowScreenIds,
  disabled,
  onRemove,
}: ScreenSnapshotControlsProps) {
  // A removed or replaced screen has no capture any more, which also closes its preview.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewIndex = snapshots.findIndex((snapshot) => snapshot.id === previewId);
  const previewCapture = previewId === null ? undefined : captures.get(previewId);

  return (
    <>
      {snapshots.map((snapshot, index) => {
        const { id } = snapshot;
        const { title, origin } = getScreenCardText(index, markedScreenIds.has(id), flowScreenIds.has(id), truncatedFlowScreenIds.has(id));
        return (
          <AttachmentCard
            key={id}
            icon={<CameraIcon className="size-4" />}
            title={title}
            description={getScreenDescription(snapshot, origin)}
            removeLabel={`저장한 화면 ${index + 1} 삭제`}
            disabled={disabled}
            onRemove={() => onRemove(id)}
            actions={
              captures.has(id) ? (
                <button
                  type="button"
                  aria-label={`저장한 화면 ${index + 1} 미리보기`}
                  aria-pressed={id === previewId}
                  className="min-h-9 shrink-0 rounded-[10px] border border-fw-border px-2 text-xs text-fw-sub aria-pressed:border-fw-primary aria-pressed:bg-fw-primary-weak aria-pressed:text-fw-primary"
                  onClick={() => setPreviewId(id === previewId ? null : id)}
                >
                  미리보기
                </button>
              ) : null
            }
          />
        );
      })}
      {previewCapture && previewIndex !== -1 ? (
        <li className="list-none">
          <ScreenSnapshotPreview
            key={previewId}
            capture={previewCapture}
            title={`저장한 화면 ${previewIndex + 1}`}
            onClose={() => setPreviewId(null)}
          />
        </li>
      ) : null}
    </>
  );
}
