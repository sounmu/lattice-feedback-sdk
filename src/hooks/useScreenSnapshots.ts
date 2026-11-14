'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ScreenCaptureResult } from '@/hooks/useHostBridge';
import { addMarkedScreen, type MarkedScreens } from '@/lib/marked-screens';
import { isCaptureCurrent, type CaptureSource } from '@/lib/screen-capture-generation';
import { keepListedCaptures } from '@/lib/screen-preview';
import { findCommentPins, findEditMoves, isReplayTruncated, reconcileScreenMarks, type LiveMarkKeys } from '@/lib/screen-snapshot';
import {
  MAX_SCREEN_SNAPSHOT_BYTES,
  MAX_SCREEN_SNAPSHOT_UNPACKED_BYTES,
  MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK,
} from '@/lib/feedback-limits';
import { GZIP_MEDIA_TYPE, gzipBytes, isGzipSupported } from '@/lib/gzip';
import type {
  CreateScreenSnapshotInput,
  CreateScreenSnapshotResponse,
  FindMissingScreenSnapshotAssetsInput,
  FindMissingScreenSnapshotAssetsResponse,
  CapturedScreen,
  ScreenCapture,
  ScreenCaptureFailureReason,
  ScreenSnapshotEvent,
  ScreenSnapshotSummary,
} from '@/types/screen-snapshot';

export type ScreenSaveStatus = 'idle' | 'capturing' | 'uploading';

interface UseScreenSnapshotsOptions {
  config: Pick<CreateScreenSnapshotInput, 'projectKey' | 'hostOrigin'> | null;
  subscribeToScreenCapture: (listener: (result: ScreenCaptureResult) => void) => () => void;
  requestScreenCapture: (requestId: string) => void;
  requestFlowCapture: (requestId: string) => void;
}

// An SDK build without screen saving never answers, so the request must not wait forever.
const CAPTURE_TIMEOUT_MS = 30_000;
const SAVE_FAILED_MESSAGE = '화면을 저장하지 못했습니다. 다시 시도해 주세요.';
const PAGE_NOT_ALLOWED_MESSAGE = '이 페이지에서는 화면을 저장할 수 없습니다.';
const PAYLOAD_TOO_LARGE_STATUS = 413;
const FLOW_SCREEN_FULL_MESSAGE = '저장할 수 있는 화면 수를 넘어 흐름 재생을 저장하지 못했습니다.';
const MARKED_SCREEN_FULL_MESSAGE = '저장할 수 있는 화면 수를 넘어 코멘트·편집 위치를 화면에 표시하지 못했습니다.';

function findMarkKeys(events: readonly ScreenSnapshotEvent[]): string[] {
  return [...findCommentPins(events).map((pin) => pin.key), ...findEditMoves(events).map((move) => move.key)];
}

// Captures are taken the moment they are asked for; uploads, and mark updates after a comment or edit is deleted, run one at a time.
interface CaptureJob {
  type: 'capture';
  capture: ScreenCapture;
  source: CaptureSource;
  /** The Flow generation the capture was asked in; only a replay is tied to it. */
  flowGeneration: number;
}

type UploadJob = CaptureJob | { type: 'reconcile' };

/** What a marked screen was saved from, kept so its marks can be updated when a comment or edit is deleted. */
interface SavedMarkedScreen {
  screen: CapturedScreen;
  assetHashes: string[];
}

type UploadOwner = Pick<CreateScreenSnapshotInput, 'projectKey' | 'hostOrigin'>;

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

async function createSnapshot(owner: UploadOwner, screen: CapturedScreen, assetHashes: string[]): Promise<ScreenSnapshotSummary> {
  const input: CreateScreenSnapshotInput = { ...owner, ...screen, assetHashes };
  const plainBody = new TextEncoder().encode(JSON.stringify(input));
  if (plainBody.length > MAX_SCREEN_SNAPSHOT_UNPACKED_BYTES) {
    throw new UploadFailedError(PAYLOAD_TOO_LARGE_STATUS);
  }
  // Sent compressed where the browser can, so a long Flow replay fits the upload limit.
  const isCompressed = isGzipSupported();
  const body = isCompressed ? await gzipBytes(plainBody) : plainBody;
  if (body.length > MAX_SCREEN_SNAPSHOT_BYTES) {
    throw new UploadFailedError(PAYLOAD_TOO_LARGE_STATUS);
  }
  const response = await sendOrThrow('/api/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': isCompressed ? GZIP_MEDIA_TYPE : 'application/json' },
    body,
  });
  return ((await response.json()) as CreateScreenSnapshotResponse).snapshot;
}

function getJobErrorMessage(error: unknown): string {
  return error instanceof UploadFailedError ? getUploadErrorMessage(error.status) : SAVE_FAILED_MESSAGE;
}

export function useScreenSnapshots({
  config,
  subscribeToScreenCapture,
  requestScreenCapture,
  requestFlowCapture,
}: UseScreenSnapshotsOptions) {
  const [screens, setScreens] = useState<MarkedScreens>({ snapshots: [], marksByScreen: new Map() });
  const { snapshots, marksByScreen } = screens;
  const markedScreenIds = useMemo(() => new Set(marksByScreen.keys()), [marksByScreen]);
  // Uploads finish asynchronously, so they read and write the latest screens through this ref.
  const screensRef = useRef(screens);
  // What each listed screen was saved from, kept in this browser so the reporter can look at it before
  // sending. It is dropped together with its screen.
  const [captures, setCaptures] = useState<ReadonlyMap<string, ScreenCapture>>(new Map());
  const capturesRef = useRef(captures);
  const [pendingCount, setPendingCount] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [flowScreenIds, setFlowScreenIds] = useState<ReadonlySet<string>>(new Set());
  // Replays whose later part was dropped by the recording limits; the reporter is told which ones.
  const [truncatedFlowScreenIds, setTruncatedFlowScreenIds] = useState<ReadonlySet<string>>(new Set());
  const pendingRequests = useRef(new Map<string, Pick<CaptureJob, 'source' | 'flowGeneration'> & { timer: number }>());
  const jobs = useRef<UploadJob[]>([]);
  const isDraining = useRef(false);
  const savedMarkedScreens = useRef(new Map<string, SavedMarkedScreen>());
  const liveMarkKeys = useRef<LiveMarkKeys>({ comments: [], edits: [] });
  // Bumped by reset so that work started for a discarded draft does not touch the new one.
  const generation = useRef(0);
  // Bumped when the Flow is removed so that its replay, still being captured or uploaded, is not added afterwards.
  const flowGeneration = useRef(0);
  const configRef = useRef(config);
  const drainRef = useRef<() => void>(() => undefined);

  let status: ScreenSaveStatus = 'idle';
  if (isUploading) {
    status = 'uploading';
  } else if (pendingCount > 0) {
    status = 'capturing';
  }

  function commitScreens(next: MarkedScreens) {
    screensRef.current = next;
    setScreens(next);
    for (const id of savedMarkedScreens.current.keys()) {
      if (!next.marksByScreen.has(id)) {
        savedMarkedScreens.current.delete(id);
      }
    }
    // A screen that left the draft lets go of its events and files.
    capturesRef.current = keepListedCaptures(capturesRef.current, next.snapshots);
    setCaptures(capturesRef.current);
  }

  // Called just before the screen is committed, so a capture is never kept for a screen that is not listed.
  function keepCapture(id: string, capture: ScreenCapture) {
    capturesRef.current = new Map(capturesRef.current).set(id, capture);
  }

  function isJobCurrent(job: UploadJob, jobGeneration: number): boolean {
    if (job.type === 'reconcile') {
      return jobGeneration === generation.current;
    }
    return isCaptureCurrent(
      job.source,
      { draft: jobGeneration, flow: job.flowGeneration },
      { draft: generation.current, flow: flowGeneration.current },
    );
  }

  async function runCapture(owner: UploadOwner, job: CaptureJob, jobGeneration: number) {
    const { source, capture: { screen, assetFiles } } = job;
    // A comment or edit deleted while its screen was being captured must not be saved with it.
    const events = source === 'marks' ? reconcileScreenMarks(screen.events, liveMarkKeys.current) : screen.events;
    if (!events) {
      return;
    }
    const pinnedScreen: CapturedScreen = { ...screen, events: [...events] };
    const assetHashes = await uploadAssetFiles({ ...owner, pageUrl: screen.page.url }, assetFiles);
    const created = await createSnapshot(owner, pinnedScreen, assetHashes);
    if (!isJobCurrent(job, jobGeneration)) {
      return;
    }
    const next = source === 'marks'
      ? addMarkedScreen(screensRef.current, created, findMarkKeys(pinnedScreen.events), MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK)
      : { ...screensRef.current, snapshots: [...screensRef.current.snapshots, created] };
    if (!next || next.snapshots.length > MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK) {
      setErrorMessage(source === 'flow' ? FLOW_SCREEN_FULL_MESSAGE : MARKED_SCREEN_FULL_MESSAGE);
      return;
    }
    if (source === 'flow') {
      setFlowScreenIds((current) => new Set([...current, created.id]));
      if (isReplayTruncated(pinnedScreen.events)) {
        setTruncatedFlowScreenIds((current) => new Set([...current, created.id]));
      }
    }
    if (source === 'marks') {
      savedMarkedScreens.current.set(created.id, { screen: pinnedScreen, assetHashes });
    }
    keepCapture(created.id, { screen: pinnedScreen, assetFiles });
    commitScreens(next);
  }

  // A deleted comment or edit must not reach the admin through a screen saved earlier: each marked screen
  // is saved again without its mark and with the remaining marks renumbered, keeping its original moment.
  async function runReconcile(owner: UploadOwner, jobGeneration: number) {
    for (const [id, saved] of [...savedMarkedScreens.current]) {
      const events = reconcileScreenMarks(saved.screen.events, liveMarkKeys.current);
      if (events === saved.screen.events) {
        continue;
      }
      const current = screensRef.current;
      if (!events) {
        commitScreens({
          snapshots: current.snapshots.filter((snapshot) => snapshot.id !== id),
          marksByScreen: new Map([...current.marksByScreen].filter(([screenId]) => screenId !== id)),
        });
        continue;
      }
      const screen: CapturedScreen = { ...saved.screen, events: [...events] };
      const created = await createSnapshot(owner, screen, saved.assetHashes);
      if (jobGeneration !== generation.current) {
        return;
      }
      const latest = screensRef.current;
      if (!latest.marksByScreen.has(id)) {
        continue;
      }
      const marks = new Map([...latest.marksByScreen].filter(([screenId]) => screenId !== id));
      marks.set(created.id, findMarkKeys(screen.events));
      savedMarkedScreens.current.set(created.id, { screen, assetHashes: saved.assetHashes });
      // The screen saved again shows the remaining marks; its files are the same ones.
      const capture = capturesRef.current.get(id);
      if (capture) {
        keepCapture(created.id, { screen, assetFiles: capture.assetFiles });
      }
      commitScreens({
        snapshots: latest.snapshots.map((snapshot) => (snapshot.id === id ? created : snapshot)),
        marksByScreen: marks,
      });
    }
  }

  async function drain() {
    const owner = configRef.current;
    if (isDraining.current || !owner) {
      return;
    }
    isDraining.current = true;
    setIsUploading(true);
    const { projectKey, hostOrigin } = owner;
    while (jobs.current.length > 0) {
      const job = jobs.current.shift() as UploadJob;
      const jobGeneration = generation.current;
      try {
        if (job.type === 'capture') {
          await runCapture({ projectKey, hostOrigin }, job, jobGeneration);
        } else {
          await runReconcile({ projectKey, hostOrigin }, jobGeneration);
        }
      } catch (error) {
        if (isJobCurrent(job, jobGeneration)) {
          setErrorMessage(getJobErrorMessage(error));
        }
      }
    }
    isDraining.current = false;
    setIsUploading(false);
  }

  useEffect(() => {
    configRef.current = config;
    drainRef.current = () => {
      void drain();
    };
  });

  useEffect(() => {
    if (!config) {
      return;
    }
    const requests = pendingRequests.current;
    const unsubscribe = subscribeToScreenCapture((result) => {
      const { requestId } = result.payload;
      const request = requests.get(requestId);
      // Only an answer to a pending request is accepted.
      if (!request) {
        return;
      }
      window.clearTimeout(request.timer);
      requests.delete(requestId);
      setPendingCount(requests.size);
      if (result.type === 'screen:capture-failed') {
        setErrorMessage(CAPTURE_FAILURE_MESSAGES[result.payload.reason]);
        return;
      }
      const { screen, assetFiles } = result.payload;
      jobs.current.push({
        type: 'capture',
        capture: { screen, assetFiles },
        source: request.source,
        flowGeneration: request.flowGeneration,
      });
      drainRef.current();
    });
    return () => {
      unsubscribe();
      requests.forEach((request) => window.clearTimeout(request.timer));
      requests.clear();
      setPendingCount(0);
    };
  }, [config, subscribeToScreenCapture]);

  const canCapture = status === 'idle' && snapshots.length < MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK;
  // A marked screen may replace an earlier one; whether it fits is checked once it is uploaded.
  const canCaptureMarks = snapshots.length < MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK || marksByScreen.size > 0;

  const startCapture = useCallback((source: CaptureSource) => {
    const requestId = crypto.randomUUID();
    const requests = pendingRequests.current;
    setErrorMessage(null);
    const timer = window.setTimeout(() => {
      requests.delete(requestId);
      setPendingCount(requests.size);
      setErrorMessage(SAVE_FAILED_MESSAGE);
    }, CAPTURE_TIMEOUT_MS);
    requests.set(requestId, { source, timer, flowGeneration: flowGeneration.current });
    setPendingCount(requests.size);
    if (source === 'flow') {
      requestFlowCapture(requestId);
    } else {
      requestScreenCapture(requestId);
    }
  }, [requestScreenCapture, requestFlowCapture]);

  const capture = useCallback(() => {
    if (canCapture) {
      startCapture('manual');
    }
  }, [canCapture, startCapture]);

  // Asked right away, even while another screen is saving, so the UI state of the comment or drop is what gets saved.
  const captureForMarks = useCallback(() => {
    if (!canCaptureMarks) {
      setErrorMessage(MARKED_SCREEN_FULL_MESSAGE);
      return;
    }
    startCapture('marks');
  }, [canCaptureMarks, startCapture]);

  // The replay of a finished Flow is saved as its own screen, which the viewer plays back.
  const captureFlow = useCallback(() => {
    if (snapshots.length >= MAX_SCREEN_SNAPSHOTS_PER_FEEDBACK) {
      setErrorMessage(FLOW_SCREEN_FULL_MESSAGE);
      return;
    }
    startCapture('flow');
  }, [snapshots.length, startCapture]);

  /** Follows the comments and edits in the draft; when one is deleted, the saved screens drop its mark. */
  const syncMarkKeys = useCallback((keys: LiveMarkKeys) => {
    const previous = liveMarkKeys.current;
    const isDeleted = previous.comments.some((key) => !keys.comments.includes(key)) ||
      previous.edits.some((key) => !keys.edits.includes(key));
    liveMarkKeys.current = keys;
    if (isDeleted && savedMarkedScreens.current.size > 0) {
      jobs.current.push({ type: 'reconcile' });
      drainRef.current();
    }
  }, []);

  const remove = useCallback((id: string) => {
    commitScreens({
      snapshots: screensRef.current.snapshots.filter((snapshot) => snapshot.id !== id),
      marksByScreen: new Map([...screensRef.current.marksByScreen].filter(([screenId]) => screenId !== id)),
    });
    setFlowScreenIds((current) => new Set([...current].filter((screenId) => screenId !== id)));
    setTruncatedFlowScreenIds((current) => new Set([...current].filter((screenId) => screenId !== id)));
  }, []);

  // A removed Flow takes its replay screens with it, including a replay that is still being captured,
  // waiting to be uploaded or uploading.
  const removeFlowScreens = useCallback(() => {
    flowGeneration.current += 1;
    const requests = pendingRequests.current;
    for (const [requestId, request] of [...requests]) {
      if (request.source === 'flow') {
        window.clearTimeout(request.timer);
        requests.delete(requestId);
      }
    }
    setPendingCount(requests.size);
    jobs.current = jobs.current.filter((job) => job.type !== 'capture' || job.source !== 'flow');
    flowScreenIds.forEach((id) => remove(id));
  }, [flowScreenIds, remove]);

  const reset = useCallback(() => {
    generation.current += 1;
    jobs.current = [];
    pendingRequests.current.forEach((request) => window.clearTimeout(request.timer));
    pendingRequests.current.clear();
    setPendingCount(0);
    commitScreens({ snapshots: [], marksByScreen: new Map() });
    setFlowScreenIds(new Set());
    setTruncatedFlowScreenIds(new Set());
    setErrorMessage(null);
  }, []);

  return {
    snapshots, captures, markedScreenIds, flowScreenIds, truncatedFlowScreenIds, captureFlow, removeFlowScreens, status, errorMessage, canCapture, capture, captureForMarks, syncMarkKeys, remove, reset,
  };
}
