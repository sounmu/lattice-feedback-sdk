// Dependency-free runtime for saved screens. The SDK bundle imports this file,
// so it must not pull in zod or any other package.
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMENTS,
  MAX_MISSING_SNAPSHOT_ASSETS,
  MAX_SNAPSHOT_ASSETS,
} from '@/lib/feedback-limits';
import type {
  CapturedScreen,
  MissingSnapshotAssetReason,
  ScreenCaptureFailureReason,
  ScreenCommentPin,
  ScreenSnapshotEvent,
  ScreenSnapshotFormat,
} from '@/types/screen-snapshot';

export const SCREEN_SNAPSHOT_FORMAT: ScreenSnapshotFormat = 'rrweb-2';

// rrweb EventType values. A saved screen is one Meta event followed by one FullSnapshot event,
// then one Custom event per comment pinned on the screen.
export const RRWEB_FULL_SNAPSHOT_EVENT_TYPE = 2;
export const RRWEB_META_EVENT_TYPE = 4;
export const RRWEB_CUSTOM_EVENT_TYPE = 5;
export const COMMENT_PIN_EVENT_TAG = 'lattice-comment-pin';
export const MAX_LABEL_LENGTH = 200;
const MAX_PIN_KEY_LENGTH = 40;
const MAX_RECT_COORDINATE = 10_000_000;

const MISSING_SNAPSHOT_ASSET_REASONS: readonly MissingSnapshotAssetReason[] = [
  'fetch_failed',
  'too_large',
  'budget_exceeded',
  'timed_out',
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

function isRectValue(value: unknown, minimum: number): boolean {
  return isFiniteNumber(value) && value >= minimum && value <= MAX_RECT_COORDINATE;
}

function isFraction(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

export function isScreenCommentPin(value: unknown): value is ScreenCommentPin {
  if (!isRecord(value) || !isRecord(value.rect)) {
    return false;
  }
  const { number, key, nodeId, rect, label, comment, offset } = value;
  return (
    isRecord(offset) && isFraction(offset.x) && isFraction(offset.y) &&
    typeof key === 'string' && key.length > 0 && key.length <= MAX_PIN_KEY_LENGTH &&
    Number.isInteger(number) && Number(number) >= 1 && Number(number) <= MAX_COMMENTS &&
    (nodeId === null || (Number.isInteger(nodeId) && Number(nodeId) >= 0)) &&
    isRectValue(rect.x, -MAX_RECT_COORDINATE) && isRectValue(rect.y, -MAX_RECT_COORDINATE) &&
    isRectValue(rect.width, 0) && isRectValue(rect.height, 0) &&
    typeof label === 'string' && label.length <= MAX_LABEL_LENGTH &&
    typeof comment === 'string' && comment.length > 0 && comment.length <= MAX_COMMENT_LENGTH
  );
}

function isCommentPinEvent(value: unknown): boolean {
  return (
    isSnapshotEvent(value, RRWEB_CUSTOM_EVENT_TYPE) &&
    isRecord((value as ScreenSnapshotEvent).data) &&
    ((value as { data: Record<string, unknown> }).data.tag === COMMENT_PIN_EVENT_TAG) &&
    isScreenCommentPin((value as { data: Record<string, unknown> }).data.payload)
  );
}

export function createCommentPinEvent(pin: ScreenCommentPin, timestamp: number): ScreenSnapshotEvent {
  return { type: RRWEB_CUSTOM_EVENT_TYPE, timestamp, data: { tag: COMMENT_PIN_EVENT_TAG, payload: pin } };
}

/**
 * The events of a saved screen with only the pins of comments that still exist, numbered by their
 * place among them. Returns the same array when nothing changes, and null when no pin is left.
 */
export function reconcileCommentPins(
  events: readonly ScreenSnapshotEvent[],
  liveKeys: readonly string[],
): readonly ScreenSnapshotEvent[] | null {
  let isChanged = false;
  let pinCount = 0;
  const next = events.flatMap((event) => {
    if (!isCommentPinEvent(event)) {
      return [event];
    }
    const pin = (event.data as { payload: ScreenCommentPin }).payload;
    const number = liveKeys.indexOf(pin.key) + 1;
    if (number === 0) {
      isChanged = true;
      return [];
    }
    pinCount += 1;
    if (number === pin.number) {
      return [event];
    }
    isChanged = true;
    return [createCommentPinEvent({ ...pin, number }, event.timestamp)];
  });
  if (pinCount === 0) {
    return null;
  }
  return isChanged ? next : events;
}

/** The comment pins of a saved screen, in event order. Malformed events are skipped. */
export function findCommentPins(events: readonly ScreenSnapshotEvent[]): ScreenCommentPin[] {
  return events.filter(isCommentPinEvent).map((event) => (event.data as { payload: ScreenCommentPin }).payload);
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
  if (!Array.isArray(events) || events.length < 2 || events.length > 2 + MAX_COMMENTS) {
    return false;
  }
  if (!isSnapshotEvent(events[0], RRWEB_META_EVENT_TYPE) || !isSnapshotEvent(events[1], RRWEB_FULL_SNAPSHOT_EVENT_TYPE)) {
    return false;
  }
  if (!events.slice(2).every(isCommentPinEvent)) {
    return false;
  }
  return (
    Array.isArray(missingAssets) &&
    missingAssets.length <= MAX_MISSING_SNAPSHOT_ASSETS &&
    missingAssets.every(isMissingAsset)
  );
}
