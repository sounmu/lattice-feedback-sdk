// Dependency-free runtime for saved screens. The SDK bundle imports this file,
// so it must not pull in zod or any other package.
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMENTS,
  MAX_EDITS,
  MAX_MISSING_SNAPSHOT_ASSETS,
  MAX_REPLAY_EVENTS,
  MAX_SNAPSHOT_ASSETS,
} from '@/lib/feedback-limits';
import type {
  CapturedScreen,
  MissingSnapshotAssetReason,
  ScreenCaptureFailureReason,
  ScreenCommentPin,
  ScreenEditMove,
  ScreenSnapshotEvent,
  ScreenSnapshotFormat,
} from '@/types/screen-snapshot';

export const SCREEN_SNAPSHOT_FORMAT: ScreenSnapshotFormat = 'rrweb-2';

// rrweb EventType values. A saved screen is one Meta event followed by one FullSnapshot event,
// then one Custom event per comment pinned or element moved on the screen.
export const RRWEB_FULL_SNAPSHOT_EVENT_TYPE = 2;
// A recorded Flow also carries the page's changes after the full snapshot as Incremental events.
export const RRWEB_INCREMENTAL_EVENT_TYPE = 3;
export const RRWEB_META_EVENT_TYPE = 4;
export const RRWEB_CUSTOM_EVENT_TYPE = 5;
export const COMMENT_PIN_EVENT_TAG = 'lattice-comment-pin';
export const EDIT_MOVE_EVENT_TAG = 'lattice-edit-move';
/** Marks a Flow replay whose later events were dropped by the count, duration or page limits. */
export const REPLAY_TRUNCATED_EVENT_TAG = 'lattice-replay-truncated';
export const MAX_SCREEN_MARK_EVENTS = MAX_COMMENTS + MAX_EDITS;
export const MAX_LABEL_LENGTH = 200;
const MAX_MARK_KEY_LENGTH = 40;
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

function isMarkRect(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRectValue(value.x, -MAX_RECT_COORDINATE) && isRectValue(value.y, -MAX_RECT_COORDINATE) &&
    isRectValue(value.width, 0) && isRectValue(value.height, 0)
  );
}

function isMarkBase(value: Record<string, unknown>, maxNumber: number): boolean {
  const { number, key, nodeId, label } = value;
  return (
    typeof key === 'string' && key.length > 0 && key.length <= MAX_MARK_KEY_LENGTH &&
    Number.isInteger(number) && Number(number) >= 1 && Number(number) <= maxNumber &&
    (nodeId === null || (Number.isInteger(nodeId) && Number(nodeId) >= 0)) &&
    typeof label === 'string' && label.length <= MAX_LABEL_LENGTH
  );
}

export function isScreenEditMove(value: unknown): value is ScreenEditMove {
  return isRecord(value) && isMarkBase(value, MAX_EDITS) && isMarkRect(value.originalRect) && isMarkRect(value.proposedRect);
}

function isFraction(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

export function isScreenCommentPin(value: unknown): value is ScreenCommentPin {
  if (!isRecord(value)) {
    return false;
  }
  const { comment, offset } = value;
  return (
    isMarkBase(value, MAX_COMMENTS) && isMarkRect(value.rect) &&
    isRecord(offset) && isFraction(offset.x) && isFraction(offset.y) &&
    typeof comment === 'string' && comment.length > 0 && comment.length <= MAX_COMMENT_LENGTH
  );
}

function findMarkPayload(value: unknown, tag: string): unknown {
  if (!isSnapshotEvent(value, RRWEB_CUSTOM_EVENT_TYPE)) {
    return undefined;
  }
  const data = (value as ScreenSnapshotEvent).data as Record<string, unknown>;
  return data.tag === tag ? data.payload : undefined;
}

function isCommentPinEvent(value: unknown): boolean {
  return isScreenCommentPin(findMarkPayload(value, COMMENT_PIN_EVENT_TAG));
}

function isEditMoveEvent(value: unknown): boolean {
  return isScreenEditMove(findMarkPayload(value, EDIT_MOVE_EVENT_TAG));
}

export function createEditMoveEvent(move: ScreenEditMove, timestamp: number): ScreenSnapshotEvent {
  return { type: RRWEB_CUSTOM_EVENT_TYPE, timestamp, data: { tag: EDIT_MOVE_EVENT_TAG, payload: move } };
}

/** The proposed element moves of a saved screen, in event order. Malformed events are skipped. */
export function findEditMoves(events: readonly ScreenSnapshotEvent[]): ScreenEditMove[] {
  return events.filter(isEditMoveEvent).map((event) => (event.data as { payload: ScreenEditMove }).payload);
}

export function createCommentPinEvent(pin: ScreenCommentPin, timestamp: number): ScreenSnapshotEvent {
  return { type: RRWEB_CUSTOM_EVENT_TYPE, timestamp, data: { tag: COMMENT_PIN_EVENT_TAG, payload: pin } };
}

/** Keys of the comments and edits that still exist in the draft, each list in its current order. */
export interface LiveMarkKeys {
  comments: readonly string[];
  edits: readonly string[];
}

/**
 * The events of a saved screen with only the comment pins and proposed moves that still exist, each
 * numbered by its place among its kind. Returns the same array when nothing changes, and null when no
 * mark is left.
 */
export function reconcileScreenMarks(
  events: readonly ScreenSnapshotEvent[],
  live: LiveMarkKeys,
): readonly ScreenSnapshotEvent[] | null {
  let isChanged = false;
  let markCount = 0;
  const next = events.flatMap((event) => {
    let liveKeys: readonly string[];
    let mark: ScreenCommentPin | ScreenEditMove;
    if (isCommentPinEvent(event)) {
      liveKeys = live.comments;
      mark = (event.data as { payload: ScreenCommentPin }).payload;
    } else if (isEditMoveEvent(event)) {
      liveKeys = live.edits;
      mark = (event.data as { payload: ScreenEditMove }).payload;
    } else {
      return [event];
    }
    const number = liveKeys.indexOf(mark.key) + 1;
    if (number === 0) {
      isChanged = true;
      return [];
    }
    markCount += 1;
    if (number === mark.number) {
      return [event];
    }
    isChanged = true;
    const data = event.data as { tag: string; payload: object };
    return [{ ...event, data: { ...data, payload: { ...mark, number } } }];
  });
  if (markCount === 0) {
    return null;
  }
  return isChanged ? next : events;
}

/** The comment pins of a saved screen, in event order. Malformed events are skipped. */
export function findCommentPins(events: readonly ScreenSnapshotEvent[]): ScreenCommentPin[] {
  return events.filter(isCommentPinEvent).map((event) => (event.data as { payload: ScreenCommentPin }).payload);
}

/** True for a recorded Flow, which the viewer plays instead of showing a still screen. */
function isReplayTruncatedEvent(value: unknown): boolean {
  return isRecord(findMarkPayload(value, REPLAY_TRUNCATED_EVENT_TAG));
}

export function createReplayTruncatedEvent(timestamp: number): ScreenSnapshotEvent {
  return { type: RRWEB_CUSTOM_EVENT_TYPE, timestamp, data: { tag: REPLAY_TRUNCATED_EVENT_TAG, payload: {} } };
}

/** Whether a saved replay is missing its later part. */
export function isReplayTruncated(events: readonly ScreenSnapshotEvent[]): boolean {
  return events.some(isReplayTruncatedEvent);
}

export function hasReplayEvents(events: readonly ScreenSnapshotEvent[]): boolean {
  return events.some((event) => event.type === RRWEB_INCREMENTAL_EVENT_TYPE);
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
  if (!Array.isArray(events) || events.length < 2 || events.length > 2 + MAX_SCREEN_MARK_EVENTS + MAX_REPLAY_EVENTS + 1) {
    return false;
  }
  if (!isSnapshotEvent(events[0], RRWEB_META_EVENT_TYPE) || !isSnapshotEvent(events[1], RRWEB_FULL_SNAPSHOT_EVENT_TYPE)) {
    return false;
  }
  if (!events.slice(2).every((event) => isCommentPinEvent(event) || isEditMoveEvent(event) || isReplayTruncatedEvent(event) ||
    isSnapshotEvent(event, RRWEB_INCREMENTAL_EVENT_TYPE))) {
    return false;
  }
  return (
    Array.isArray(missingAssets) &&
    missingAssets.length <= MAX_MISSING_SNAPSHOT_ASSETS &&
    missingAssets.every(isMissingAsset)
  );
}
