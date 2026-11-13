// Dependency-free runtime for saved screens. The SDK bundle imports this file,
// so it must not pull in zod or any other package.
import { MAX_MISSING_SNAPSHOT_ASSETS, MAX_SNAPSHOT_ASSETS } from '@/lib/feedback-limits';
import type {
  CapturedScreen,
  MissingSnapshotAssetReason,
  ScreenCaptureFailureReason,
  ScreenSnapshotFormat,
} from '@/types/screen-snapshot';

export const SCREEN_SNAPSHOT_FORMAT: ScreenSnapshotFormat = 'rrweb-2';

// rrweb EventType values. A saved screen is one Meta event followed by one FullSnapshot event.
export const RRWEB_FULL_SNAPSHOT_EVENT_TYPE = 2;
export const RRWEB_META_EVENT_TYPE = 4;

const MISSING_SNAPSHOT_ASSET_REASONS: readonly MissingSnapshotAssetReason[] = [
  'fetch_failed',
  'too_large',
  'budget_exceeded',
];

const SCREEN_CAPTURE_FAILURE_REASONS: readonly ScreenCaptureFailureReason[] = ['page_not_allowed', 'capture_failed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSnapshotEvent(value: unknown, type: number): boolean {
  return isRecord(value) && value.type === type && isFiniteNumber(value.timestamp) && isRecord(value.data);
}

function isMissingAsset(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    MISSING_SNAPSHOT_ASSET_REASONS.some((reason) => reason === value.reason)
  );
}

export function isAssetFileList(value: unknown): value is Blob[] {
  return Array.isArray(value) && value.length <= MAX_SNAPSHOT_ASSETS && value.every((file) => file instanceof Blob);
}

export function isScreenCaptureFailureReason(value: unknown): value is ScreenCaptureFailureReason {
  return SCREEN_CAPTURE_FAILURE_REASONS.some((reason) => reason === value);
}

export function isCapturedScreen(value: unknown): value is CapturedScreen {
  if (!isRecord(value) || value.format !== SCREEN_SNAPSHOT_FORMAT || typeof value.capturedAt !== 'string') {
    return false;
  }
  const { page, events, missingAssets } = value;
  if (!isRecord(page) || typeof page.url !== 'string' || typeof page.title !== 'string') {
    return false;
  }
  if (![page.viewportWidth, page.viewportHeight, page.scrollX, page.scrollY].every(isFiniteNumber)) {
    return false;
  }
  if (!Array.isArray(events) || events.length !== 2) {
    return false;
  }
  if (!isSnapshotEvent(events[0], RRWEB_META_EVENT_TYPE) || !isSnapshotEvent(events[1], RRWEB_FULL_SNAPSHOT_EVENT_TYPE)) {
    return false;
  }
  return (
    Array.isArray(missingAssets) &&
    missingAssets.length <= MAX_MISSING_SNAPSHOT_ASSETS &&
    missingAssets.every(isMissingAsset)
  );
}
