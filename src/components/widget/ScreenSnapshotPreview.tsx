'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { VStack } from '@astryxdesign/core/VStack';

import { ScreenReplay, type ZoomModeButtonProps } from '@/components/admin/ScreenSnapshotViewer';
import type { ScreenCapture } from '@/types/screen-snapshot';

interface ScreenSnapshotPreviewProps {
  capture: ScreenCapture;
  title: string;
  onClose: () => void;
}

// The replay's zoom modes as the widget's own toggle buttons, so they look and respond like its other
// controls. Pressing the mode that is already on leaves it on.
function PreviewModeButton({ label, isPressed, onPress }: ZoomModeButtonProps) {
  return (
    <ToggleButton label={label} size="lg" isPressed={isPressed} onPressedChange={onPress}>
      {label}
    </ToggleButton>
  );
}

// Shows a screen from what this browser captured. Nothing is read back from the server, so the widget
// needs no admin token; the page is rebuilt in the same sandboxed iframe the admin viewer uses. Here it is
// a picture to look at before sending, so the links and buttons of the rebuilt page are not tab stops.
export function ScreenSnapshotPreview({ capture, title, onClose }: ScreenSnapshotPreviewProps) {
  const { screen, assetFiles } = capture;
  const sectionRef = useRef<HTMLElement>(null);
  // The replay revokes these URLs when it closes; the files themselves stay with the capture.
  const loadAssetUrls = useCallback(async () => assetFiles.map((file) => URL.createObjectURL(file)), [assetFiles]);

  // The preview is listed after the last card, out of view of the button that opened it.
  useEffect(() => {
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <section ref={sectionRef} aria-label={`${title} 미리보기`} className="widget-screen-preview w-full min-w-0">
      <Card padding={2} variant="muted">
        <VStack gap={2}>
          <HStack gap={2} align="center" justify="between">
            <Heading level={4} accessibilityLevel={2} className="min-w-0">
              {title} 미리보기
            </Heading>
            <Button label="미리보기 닫기" size="lg" onClick={onClose} />
          </HStack>
          <Text as="p" type="supporting">
            담당자에게 전달될 화면이에요. 이 브라우저에 남아 있는 자료로 보여 드려요.
          </Text>
          <ScreenReplay screen={screen} loadAssetUrls={loadAssetUrls} modeButton={PreviewModeButton} isInert />
          {screen.missingAssets.some((item) => item.reason === 'text_masked' || item.reason === 'text_index_incomplete') && (
            <Text as="p" type="supporting">
              데이터로 추정하거나 정적 출처를 확인하지 못한 텍스트는 전송 전에 ●로 가렸습니다.
            </Text>
          )}
        </VStack>
      </Card>
    </section>
  );
}
