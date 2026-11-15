'use client';

import { useCallback, useEffect, useRef } from 'react';

import { ScreenReplay } from '@/components/admin/ScreenSnapshotViewer';
import type { ScreenCapture } from '@/types/screen-snapshot';

interface ScreenSnapshotPreviewProps {
  capture: ScreenCapture;
  title: string;
  onClose: () => void;
}

// Shows a screen from what this browser captured. Nothing is read back from the server, so the widget
// needs no admin token; the page is rebuilt in the same sandboxed iframe the admin viewer uses.
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
    <section ref={sectionRef} aria-label={`${title} 미리보기`} className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-fw-border bg-fw-surface-sub p-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 break-words text-xs font-semibold">{title} 미리보기</h2>
        <button type="button" className="min-h-11 shrink-0 rounded-[10px] border border-fw-border bg-fw-surface px-3 text-xs" onClick={onClose}>
          미리보기 닫기
        </button>
      </div>
      <p className="break-words text-xs text-fw-sub">
        담당자에게 전달될 화면이에요. 이 브라우저에 남아 있는 자료로 보여 드려요.
      </p>
      <ScreenReplay screen={screen} loadAssetUrls={loadAssetUrls} />
    </section>
  );
}
