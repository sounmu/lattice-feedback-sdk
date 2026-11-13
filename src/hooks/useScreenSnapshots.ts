'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ScreenCaptureResult } from '@/hooks/useHostBridge';
import { MAX_SCREEN_SNAPSHOT_BYTES, MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK } from '@/lib/feedback-limits';
import type {
  CapturedScreen,
  CreateScreenSnapshotInput,
  CreateScreenSnapshotResponse,
  ScreenCaptureFailureReason,
  ScreenSnapshotSummary,
} from '@/types/screen-snapshot';

export type ScreenSaveStatus = 'idle' | 'capturing' | 'uploading';

interface UseScreenSnapshotsOptions {
  config: Pick<CreateScreenSnapshotInput, 'projectKey' | 'hostOrigin'> | null;
  subscribeToScreenCapture: (listener: (result: ScreenCaptureResult) => void) => () => void;
  requestScreenCapture: () => void;
}

// An SDK build without screen saving never answers, so the request must not wait forever.
const CAPTURE_TIMEOUT_MS = 30_000;
const SAVE_FAILED_MESSAGE = '화면을 저장하지 못했습니다. 다시 시도해 주세요.';
const PAGE_NOT_ALLOWED_MESSAGE = '이 페이지에서는 화면을 저장할 수 없습니다.';
const PAYLOAD_TOO_LARGE_STATUS = 413;

const CAPTURE_FAILURE_MESSAGES: Record<ScreenCaptureFailureReason, string> = {
  page_not_allowed: PAGE_NOT_ALLOWED_MESSAGE,
  capture_failed: SAVE_FAILED_MESSAGE,
};

function getUploadErrorMessage(status: number): string {
  switch (status) {
    case PAYLOAD_TOO_LARGE_STATUS:
      return '화면이 너무 커서 저장할 수 없습니다.';
    case 403:
      return PAGE_NOT_ALLOWED_MESSAGE;
    case 429:
      return '화면을 너무 자주 저장했습니다. 잠시 후 다시 시도해 주세요.';
    case 503:
      return '화면 저장소를 사용할 수 없습니다. 화면 없이도 피드백을 보낼 수 있습니다.';
    default:
      return SAVE_FAILED_MESSAGE;
  }
}

export function useScreenSnapshots({ config, subscribeToScreenCapture, requestScreenCapture }: UseScreenSnapshotsOptions) {
  const [snapshots, setSnapshots] = useState<ScreenSnapshotSummary[]>([]);
  const [status, setStatus] = useState<ScreenSaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const captureTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!config) {
      return;
    }
    const { projectKey, hostOrigin } = config;

    async function upload(screen: CapturedScreen) {
      setStatus('uploading');
      try {
        const input: CreateScreenSnapshotInput = { projectKey, hostOrigin, ...screen };
        const body = new TextEncoder().encode(JSON.stringify(input));
        if (body.length > MAX_SCREEN_SNAPSHOT_BYTES) {
          setErrorMessage(getUploadErrorMessage(PAYLOAD_TOO_LARGE_STATUS));
          return;
        }
        const response = await fetch('/api/snapshots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (!response.ok) {
          setErrorMessage(getUploadErrorMessage(response.status));
          return;
        }
        const created = (await response.json()) as CreateScreenSnapshotResponse;
        setSnapshots((current) => [...current, created.snapshot]);
      } catch {
        setErrorMessage(SAVE_FAILED_MESSAGE);
      } finally {
        setStatus('idle');
      }
    }

    const unsubscribe = subscribeToScreenCapture((result) => {
      // Only an answer to a pending request is accepted.
      if (captureTimer.current === null) {
        return;
      }
      window.clearTimeout(captureTimer.current);
      captureTimer.current = null;
      if (result.type === 'screen:capture-failed') {
        setStatus('idle');
        setErrorMessage(CAPTURE_FAILURE_MESSAGES[result.payload.reason]);
        return;
      }
      void upload(result.payload.screen);
    });
    return () => {
      unsubscribe();
      if (captureTimer.current !== null) {
        window.clearTimeout(captureTimer.current);
        captureTimer.current = null;
      }
    };
  }, [config, subscribeToScreenCapture]);

  const canCapture = status === 'idle' && snapshots.length < MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK;

  const capture = useCallback(() => {
    if (!canCapture) {
      return;
    }
    setErrorMessage(null);
    setStatus('capturing');
    captureTimer.current = window.setTimeout(() => {
      captureTimer.current = null;
      setStatus('idle');
      setErrorMessage(SAVE_FAILED_MESSAGE);
    }, CAPTURE_TIMEOUT_MS);
    requestScreenCapture();
  }, [canCapture, requestScreenCapture]);

  const remove = useCallback((id: string) => {
    setSnapshots((current) => current.filter((snapshot) => snapshot.id !== id));
  }, []);

  const reset = useCallback(() => {
    setSnapshots([]);
    setErrorMessage(null);
  }, []);

  return { snapshots, status, errorMessage, canCapture, capture, remove, reset };
}
