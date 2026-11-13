'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ScreenCaptureResult } from '@/hooks/useHostBridge';
import { addCommentScreen, type CommentScreens } from '@/lib/comment-screens';
import { findCommentPins } from '@/lib/screen-snapshot';
import { MAX_SCREEN_SNAPSHOT_BYTES, MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK } from '@/lib/feedback-limits';
import type {
  CreateScreenSnapshotInput,
  CreateScreenSnapshotResponse,
  FindMissingScreenSnapshotAssetsInput,
  FindMissingScreenSnapshotAssetsResponse,
  ScreenCapture,
  ScreenCaptureFailureReason,
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
const COMMENT_SCREEN_FULL_MESSAGE = '저장할 수 있는 화면 수를 넘어 코멘트 위치를 화면에 표시하지 못했습니다.';

type CaptureSource = 'manual' | 'comment';

const CAPTURE_FAILURE_MESSAGES: Record<ScreenCaptureFailureReason, string> = {
  page_not_allowed: PAGE_NOT_ALLOWED_MESSAGE,
  capture_failed: SAVE_FAILED_MESSAGE,
};

class UploadFailedError extends Error {
  constructor(readonly status: number) {
    super(`Upload failed with status ${status}.`);
    this.name = 'UploadFailedError';
  }
}

async function getSha256Hex(file: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sendOrThrow(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new UploadFailedError(response.status);
  }
  return response;
}

// Each project stores a file once, so only the files the server has not seen are uploaded.
async function uploadAssetFiles(
  owner: Pick<FindMissingScreenSnapshotAssetsInput, 'projectKey' | 'hostOrigin' | 'pageUrl'>,
  assetFiles: Blob[],
): Promise<string[]> {
  const hashes = await Promise.all(assetFiles.map(getSha256Hex));
  if (hashes.length === 0) {
    return hashes;
  }
  const lookup: FindMissingScreenSnapshotAssetsInput = { ...owner, hashes: [...new Set(hashes)] };
  const response = await sendOrThrow('/api/snapshots/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lookup),
  });
  const { missingHashes } = (await response.json()) as FindMissingScreenSnapshotAssetsResponse;
  const query = new URLSearchParams(owner).toString();
  for (const hash of missingHashes) {
    const file = assetFiles[hashes.indexOf(hash)];
    await sendOrThrow(`/api/snapshots/assets/${hash}?${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
  }
  return hashes;
}

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
  const [screens, setScreens] = useState<CommentScreens>({ snapshots: [], commentPinsByScreen: new Map() });
  const { snapshots, commentPinsByScreen } = screens;
  const commentScreenIds = useMemo(() => new Set(commentPinsByScreen.keys()), [commentPinsByScreen]);
  // Uploads finish asynchronously, so the limit check reads the latest screens from here.
  const screensRef = useRef(screens);
  const [status, setStatus] = useState<ScreenSaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const captureTimer = useRef<number | null>(null);
  const pendingSource = useRef<CaptureSource>('manual');
  // A comment attached while another screen is being saved gets its own save afterwards.
  const isCommentCaptureQueued = useRef(false);
  const startCaptureRef = useRef<(source: CaptureSource) => void>(() => undefined);

  useEffect(() => {
    if (!config) {
      return;
    }
    const { projectKey, hostOrigin } = config;

    async function upload({ screen, assetFiles }: ScreenCapture, source: CaptureSource) {
      setStatus('uploading');
      try {
        const assetHashes = await uploadAssetFiles({ projectKey, hostOrigin, pageUrl: screen.page.url }, assetFiles);
        const input: CreateScreenSnapshotInput = { projectKey, hostOrigin, ...screen, assetHashes };
        const body = new TextEncoder().encode(JSON.stringify(input));
        if (body.length > MAX_SCREEN_SNAPSHOT_BYTES) {
          setErrorMessage(getUploadErrorMessage(PAYLOAD_TOO_LARGE_STATUS));
          return;
        }
        const response = await sendOrThrow('/api/snapshots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const created = (await response.json()) as CreateScreenSnapshotResponse;
        const pinKeys = findCommentPins(screen.events).map((pin) => pin.key);
        const next = source === 'comment'
          ? addCommentScreen(screensRef.current, created.snapshot, pinKeys, MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK)
          : { ...screensRef.current, snapshots: [...screensRef.current.snapshots, created.snapshot] };
        if (!next) {
          setErrorMessage(COMMENT_SCREEN_FULL_MESSAGE);
          return;
        }
        screensRef.current = next;
        setScreens(next);
      } catch (error) {
        if (error instanceof UploadFailedError) {
          setErrorMessage(getUploadErrorMessage(error.status));
        } else {
          setErrorMessage(SAVE_FAILED_MESSAGE);
        }
      } finally {
        setStatus('idle');
        runQueuedCommentCapture();
      }
    }

    function runQueuedCommentCapture() {
      if (isCommentCaptureQueued.current) {
        isCommentCaptureQueued.current = false;
        startCaptureRef.current('comment');
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
        runQueuedCommentCapture();
        return;
      }
      void upload(result.payload, pendingSource.current);
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
  // A comment screen may replace an earlier one; whether it fits is checked once it is uploaded.
  const canCaptureComment = canCapture || (status === 'idle' && commentPinsByScreen.size > 0);

  const startCapture = useCallback((source: CaptureSource) => {
    pendingSource.current = source;
    setErrorMessage(null);
    setStatus('capturing');
    captureTimer.current = window.setTimeout(() => {
      captureTimer.current = null;
      setStatus('idle');
      setErrorMessage(SAVE_FAILED_MESSAGE);
    }, CAPTURE_TIMEOUT_MS);
    requestScreenCapture();
  }, [requestScreenCapture]);

  const capture = useCallback(() => {
    if (canCapture) {
      startCapture('manual');
    }
  }, [canCapture, startCapture]);

  const captureForComment = useCallback(() => {
    if (status !== 'idle') {
      isCommentCaptureQueued.current = true;
      return;
    }
    if (!canCaptureComment) {
      setErrorMessage(COMMENT_SCREEN_FULL_MESSAGE);
      return;
    }
    startCapture('comment');
  }, [status, canCaptureComment, startCapture]);

  useEffect(() => {
    startCaptureRef.current = startCapture;
  }, [startCapture]);

  const remove = useCallback((id: string) => {
    const next = {
      snapshots: screensRef.current.snapshots.filter((snapshot) => snapshot.id !== id),
      commentPinsByScreen: new Map([...screensRef.current.commentPinsByScreen].filter(([screenId]) => screenId !== id)),
    };
    screensRef.current = next;
    setScreens(next);
  }, []);

  // A deleted comment must not reach the admin through a screen saved earlier, so those screens are dropped.
  const removeScreensWithComment = useCallback((key: string): boolean => {
    const dropped = new Set([...screensRef.current.commentPinsByScreen].filter(([, keys]) => keys.includes(key)).map(([id]) => id));
    if (dropped.size === 0) {
      return false;
    }
    const next = {
      snapshots: screensRef.current.snapshots.filter((snapshot) => !dropped.has(snapshot.id)),
      commentPinsByScreen: new Map([...screensRef.current.commentPinsByScreen].filter(([id]) => !dropped.has(id))),
    };
    screensRef.current = next;
    setScreens(next);
    return true;
  }, []);

  const reset = useCallback(() => {
    const empty: CommentScreens = { snapshots: [], commentPinsByScreen: new Map() };
    screensRef.current = empty;
    setScreens(empty);
    isCommentCaptureQueued.current = false;
    setErrorMessage(null);
  }, []);

  return { snapshots, commentScreenIds, removeScreensWithComment, status, errorMessage, canCapture, capture, captureForComment, remove, reset };
}
