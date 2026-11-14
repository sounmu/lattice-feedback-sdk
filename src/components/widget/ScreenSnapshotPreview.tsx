'use client';

import { useCallback } from 'react';

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
  // The replay revokes these URLs when it closes; the files themselves stay with the capture.
  const loadAssetUrls = useCallback(async () => assetFiles.map((file) => URL.createObjectURL(file)), [assetFiles]);

  return (
    <section aria-label={`${title} 미리보기`} className="flex w-full min-w-0 flex-col gap-2 rounded border bg-gray-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 break-words text-xs font-semibold">{title} 미리보기</h2>
        <button type="button" className="min-h-11 shrink-0 rounded border bg-white px-3 text-xs" onClick={onClose}>
          미리보기 닫기
        </button>
      </div>
      <p className="break-words text-xs text-gray-600">
        관리자에게 전달될 화면을 이 브라우저에 보관된 자료로 보여 줍니다.
      </p>
      <ScreenReplay screen={screen} loadAssetUrls={loadAssetUrls} />
    </section>
  );
}
