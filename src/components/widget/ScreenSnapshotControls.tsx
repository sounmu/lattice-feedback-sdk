'use client';

import { useEffect } from 'react';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';

import { CameraIcon } from '@/components/widget/WidgetIcons';
import { AttachmentCard } from '@/components/widget/WidgetLayout';
import { PREVIEW_TOGGLE_ATTRIBUTE } from '@/hooks/useScreenPreview';
import type { PreviewContent } from '@/types/sdk-message';
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
  /** The screen the large preview is showing, if it is open. */
  previewId: string | null;
  onPreview: (id: string, content: PreviewContent) => void;
  onPreviewClose: () => void;
}

interface ScreenCardText {
  name: string;
  /** What the screen holds besides the page, when it was saved automatically. */
  kind: string | null;
  /** Why the screen was saved, when it was saved automatically. */
  origin: string | null;
}

function getScreenCardText(index: number, isMarked: boolean, isFlow: boolean, isTruncatedFlow: boolean): ScreenCardText {
  const name = `저장한 화면 ${index + 1}`;
  if (isTruncatedFlow) {
    return { name, kind: '흐름 재생(뒷부분 잘림)', origin: '흐름 기록을 마칠 때 자동으로 저장됐어요' };
  }
  if (isFlow) {
    return { name, kind: '흐름 재생', origin: '흐름 기록을 마칠 때 자동으로 저장됐어요' };
  }
  if (isMarked) {
    return { name, kind: '코멘트·편집 위치 포함', origin: '코멘트·편집 위치를 표시하려고 자동으로 저장됐어요' };
  }
  return { name, kind: null, origin: null };
}

function getScreenDescription(snapshot: ScreenSnapshotSummary, lead: string | null): string {
  const { viewportWidth, viewportHeight } = snapshot.page;
  const time = new Date(snapshot.capturedAt).toLocaleTimeString('ko-KR');
  const parts = [`${viewportWidth}×${viewportHeight}`, time];
  if (lead) {
    parts.unshift(lead);
  }
  if (snapshot.missingAssets.length > 0) {
    parts.push(`가림·누락 기록 ${snapshot.missingAssets.length}개`);
  }
  return parts.join(' · ');
}

/** Cards for the saved screens, after the comment, edit and Flow cards. Each opens the large preview of its screen. */
export function ScreenSnapshotControls({
  snapshots,
  captures,
  markedScreenIds,
  flowScreenIds,
  truncatedFlowScreenIds,
  disabled,
  onRemove,
  previewId,
  onPreview,
  onPreviewClose,
}: ScreenSnapshotControlsProps) {
  // The preview belongs to a listed screen. A removed or replaced screen has no capture any more, which
  // closes its preview, and so does this list going away.
  const isPreviewedScreenGone = previewId !== null && !captures.has(previewId);
  useEffect(() => {
    if (isPreviewedScreenGone) {
      onPreviewClose();
    }
  }, [isPreviewedScreenGone, onPreviewClose]);
  useEffect(() => onPreviewClose, [onPreviewClose]);

  return (
    <>
      {snapshots.map((snapshot, index) => {
        const { id } = snapshot;
        const { name, kind, origin } = getScreenCardText(index, markedScreenIds.has(id), flowScreenIds.has(id), truncatedFlowScreenIds.has(id));
        const capture = captures.get(id);
        const previewTitle = `${name} 미리보기`;
        return (
          <AttachmentCard
            key={id}
            kind="screen"
            icon={CameraIcon}
            title={kind ? `${name} · ${kind}` : name}
            description={getScreenDescription(snapshot, origin)}
            removeLabel={`${name} 삭제`}
            disabled={disabled}
            onRemove={() => onRemove(id)}
            actions={
              capture ? (
                <ToggleButton
                  label={previewTitle}
                  size="lg"
                  isPressed={id === previewId}
                  onPressedChange={(isPressed) => {
                    if (isPressed) {
                      onPreview(id, { title: previewTitle, subtitle: getScreenDescription(snapshot, kind), capture });
                    } else {
                      onPreviewClose();
                    }
                  }}
                  {...{ [PREVIEW_TOGGLE_ATTRIBUTE]: id }}
                >
                  미리보기
                </ToggleButton>
              ) : null
            }
          />
        );
      })}
    </>
  );
}
