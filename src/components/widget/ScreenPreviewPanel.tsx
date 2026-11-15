'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useFocusTrap } from '@astryxdesign/core/hooks';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

import { ScreenReplay } from '@/components/admin/ScreenSnapshotViewer';
import { PREVIEW_REPLAY_PARTS } from '@/components/widget/PreviewReplayParts';
import { WidgetBanner, WidgetBody, WidgetHeader } from '@/components/widget/WidgetLayout';
import { usePreviewContent, type PreviewState } from '@/hooks/usePreviewContent';
import { hasReplayEvents } from '@/lib/screen-snapshot';
import type { PreviewContent } from '@/types/sdk-message';

const TITLE_ID = 'screen-preview-title';
const CLOSE_LABEL = '미리보기 닫기';
const WAITING_TITLE = '저장한 화면 미리보기';
const WAITING_MESSAGE = '미리보기를 불러오는 중이에요…';
const FAILED_MESSAGE = '화면을 불러오지 못했어요';
const FRAME_LABEL = '저장한 화면 스크롤 영역';

function getSubtitle(state: PreviewState): string {
  switch (state.status) {
    case 'ready':
      return state.content.subtitle;
    case 'failed':
      return FAILED_MESSAGE;
    default:
      return WAITING_MESSAGE;
  }
}

// Shows a screen from what this browser captured. Nothing is read back from the server, so the preview
// needs no admin token; the page is rebuilt in the same sandboxed iframe the admin viewer uses. Here it is
// a picture to look at before sending, so the links and buttons of the rebuilt page are not tab stops.
function PreviewScreen({ content }: { content: PreviewContent }) {
  const { screen, assetFiles } = content.capture;
  // The replay revokes these URLs when it closes; the files themselves stay with the widget.
  const loadAssetUrls = useCallback(async () => assetFiles.map((file) => URL.createObjectURL(file)), [assetFiles]);
  const hasMaskedText = screen.missingAssets.some((item) => item.reason === 'text_masked' || item.reason === 'text_index_incomplete');
  const isReplay = useMemo(() => hasReplayEvents(screen.events), [screen]);

  // The screen comes first. What explains it follows, so the screen keeps the room above the fold.
  return (
    <>
      <ScreenReplay
        screen={screen}
        loadAssetUrls={loadAssetUrls}
        isInert
        parts={PREVIEW_REPLAY_PARTS}
        className="widget-replay"
        frameClassName="widget-replay-frame"
        frameLabel={FRAME_LABEL}
      />
      <VStack gap={1}>
        <Text as="p" type="supporting">
          담당자에게 전달될 화면이에요. 이 브라우저에 남아 있는 자료로 보여 드려요.
        </Text>
        {isReplay ? (
          <Text as="p" type="supporting">
            기록한 조작과 페이지 이동 전후의 화면을 재생해요. 입력한 값은 가려져 있어요.
          </Text>
        ) : null}
        {hasMaskedText ? (
          <Text as="p" type="supporting">
            데이터로 추정하거나 정적 출처를 확인하지 못한 텍스트는 전송 전에 ●로 가렸어요.
          </Text>
        ) : null}
      </VStack>
    </>
  );
}

/** The large preview of one saved screen: the whole document of the panel the SDK opens next to the widget. */
export function ScreenPreviewPanel() {
  const { state, requestClose } = usePreviewContent();
  const { containerRef } = useFocusTrap<HTMLDivElement>({ isActive: true, onEscape: requestClose });

  // The SDK moves keyboard focus into this frame once it has loaded, and focus set before that does not
  // last. So the title takes it whenever the frame gains focus with nothing inside focused: a screen reader
  // starts with the dialog's name, and the next Tab lands on the close button.
  useEffect(() => {
    function focusTitle() {
      if (document.activeElement === null || document.activeElement === document.body) {
        document.getElementById(TITLE_ID)?.focus({ preventScroll: true });
      }
    }
    focusTitle();
    window.addEventListener('focus', focusTitle);
    return () => window.removeEventListener('focus', focusTitle);
  }, []);

  function renderBody() {
    if (state.status === 'failed') {
      return (
        <WidgetBanner tone="danger" title="미리보기를 열 수 없어요" isAlert>
          미리보기를 닫은 뒤 다시 열어 주세요.
        </WidgetBanner>
      );
    }
    if (state.status === 'waiting') {
      return (
        <div role="status" aria-label={WAITING_MESSAGE}>
          <VStack gap={3}>
            <Skeleton height={16} width="40%" index={0} />
            <Skeleton height={320} width="100%" index={1} />
          </VStack>
        </div>
      );
    }
    return <PreviewScreen key={state.revision} content={state.content} />;
  }

  return (
    <div
      ref={containerRef}
      lang="ko"
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      className="widget-root flex h-dvh flex-col overflow-hidden"
    >
      <div className="shrink-0 border-b border-(--color-border)">
        <WidgetHeader
          title={state.status === 'ready' ? state.content.title : WAITING_TITLE}
          subtitle={getSubtitle(state)}
          titleId={TITLE_ID}
          hasAvatar={false}
          closeLabel={CLOSE_LABEL}
          onClose={requestClose}
        />
      </div>
      <WidgetBody>{renderBody()}</WidgetBody>
    </div>
  );
}
