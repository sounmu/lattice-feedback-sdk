import { expect, it } from 'vitest';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import {
  createCommentPinEvent,
  createEditMoveEvent,
  createReplayTruncatedEvent,
  findCommentPins,
  findEditMoves,
  findUnshownEditIndexes,
  hasReplayEvents,
  isCapturedScreen,
  isReplayTruncated,
  reconcileScreenMarks,
  removeScreenMarks,
  REPLAY_TRUNCATED_EVENT_TAG,
} from '@/lib/screen-snapshot';
import { createScreenSnapshotInputSchema } from '@/lib/validation/screen-snapshot-schema';
import type { ScreenCommentPin, ScreenEditMove, ScreenSnapshotEvent } from '@/types/screen-snapshot';

const MOVE: ScreenEditMove = {
  number: 1,
  key: 'edit-2',
  nodeId: 9,
  originalRect: { x: 10, y: 20, width: 80, height: 30 },
  proposedRect: { x: 110, y: -20, width: 80, height: 30 },
  label: 'save',
};
const PIN: ScreenCommentPin = { number: 1, key: 'comment-1', nodeId: 7, rect: { x: 10, y: 20, width: 80, height: 30 }, offset: { x: 0.25, y: 0.5 }, label: 'save', comment: '버튼이 안 보여요' };

function createScreen(extraEvents: unknown[]) {
  const screen = createScreenSnapshotBody();
  return { ...screen, events: [...(screen.events as unknown[]), ...extraEvents] };
}

it('accepts comment pins after the full snapshot and reads them back in order', () => {
  const second = { ...PIN, number: 2, nodeId: null };
  const screen = createScreen([createCommentPinEvent(PIN, 1), createCommentPinEvent(second, 1)]);

  expect(isCapturedScreen(screen)).toBe(true);
  expect(findCommentPins(screen.events as ScreenSnapshotEvent[])).toEqual([PIN, second]);
});

it('rejects malformed pins and other trailing events', () => {
  const malformed = [
    createCommentPinEvent({ ...PIN, comment: '' }, 1),
    createCommentPinEvent({ ...PIN, number: 0 }, 1),
    createCommentPinEvent({ ...PIN, rect: { ...PIN.rect, width: -1 } }, 1),
    createCommentPinEvent({ ...PIN, offset: { x: 1.5, y: 0 } }, 1),
    { type: 5, timestamp: 1, data: { tag: 'other', payload: PIN } },
    { type: 1, timestamp: 1, data: {} },
  ];
  for (const event of malformed) {
    expect(isCapturedScreen(createScreen([event]))).toBe(false);
  }
  expect(findCommentPins(malformed as ScreenSnapshotEvent[])).toEqual([]);
});

it('accepts proposed moves next to comment pins and reads each kind separately', () => {
  const move = MOVE;
  const screen = createScreen([createCommentPinEvent(PIN, 1), createEditMoveEvent(move, 1)]);
  const events = screen.events as ScreenSnapshotEvent[];

  expect(isCapturedScreen(screen)).toBe(true);
  expect(findEditMoves(events)).toEqual([move]);
  expect(findCommentPins(events)).toEqual([PIN]);
  expect(isCapturedScreen(createScreen([createEditMoveEvent({ ...move, number: 11 }, 1)]))).toBe(false);
  expect(isCapturedScreen(createScreen([createEditMoveEvent({ ...move, proposedRect: { x: 0, y: 0, width: -1, height: 0 } }, 1)]))).toBe(false);
});

it('drops the marks of deleted comments and edits from a saved screen and renumbers each kind', () => {
  const events = createScreen([
    createCommentPinEvent(PIN, 1),
    createCommentPinEvent({ ...PIN, number: 2, key: 'comment-2' }, 1),
    createCommentPinEvent({ ...PIN, number: 3, key: 'comment-3' }, 1),
    createEditMoveEvent(MOVE, 1),
    createEditMoveEvent({ ...MOVE, number: 2, key: 'edit-3' }, 1),
  ]).events as ScreenSnapshotEvent[];

  const kept = reconcileScreenMarks(events, { comments: ['comment-1', 'comment-2', 'comment-3'], edits: ['edit-2', 'edit-3'] });
  const updated = reconcileScreenMarks(events, { comments: ['comment-2', 'comment-3'], edits: ['edit-3'] }) ?? [];

  expect(kept).toBe(events);
  expect(findCommentPins(updated).map(({ key, number }) => [key, number])).toEqual([['comment-2', 1], ['comment-3', 2]]);
  expect(findEditMoves(updated).map(({ key, number }) => [key, number])).toEqual([['edit-3', 1]]);
  expect(updated.slice(0, 2)).toEqual(events.slice(0, 2));
  expect(reconcileScreenMarks(events, { comments: ['comment-9'], edits: [] })).toBeNull();
});

it('takes every pin and move out of a screen saved by hand and keeps the page itself', () => {
  const events = createScreen([createCommentPinEvent(PIN, 1), createEditMoveEvent(MOVE, 1)]).events as ScreenSnapshotEvent[];

  const cleaned = removeScreenMarks(events);

  expect(cleaned).toEqual(events.slice(0, 2));
  expect(isCapturedScreen({ ...createScreen([]), events: cleaned })).toBe(true);
});

it('lists the edits a saved screen does not show, by their position in the feedback', () => {
  expect(findUnshownEditIndexes(3, [{ ...MOVE, number: 2 }])).toEqual([0, 2]);
  expect(findUnshownEditIndexes(1, [{ ...MOVE, number: 1 }])).toEqual([]);
  expect(findUnshownEditIndexes(2, [])).toEqual([0, 1]);
});

it('accepts the page changes of a recorded Flow and tells a replay apart from a still screen', () => {
  const replay = createScreen([{ type: 3, timestamp: 2, data: { source: 2, type: 2, id: 5, x: 10, y: 20 } }]);
  const still = createScreen([]);

  expect(isCapturedScreen(replay)).toBe(true);
  expect(hasReplayEvents(replay.events as ScreenSnapshotEvent[])).toBe(true);
  expect(hasReplayEvents(still.events as ScreenSnapshotEvent[])).toBe(false);
  expect(isCapturedScreen(createScreen([{ type: 3, timestamp: 2, data: 'not an object' }]))).toBe(false);
});

it('accepts the marker of a replay that lost its later part and tells such a replay from a whole one', () => {
  const change = { type: 3, timestamp: 2, data: { source: 2, type: 2, id: 5, x: 10, y: 20 } };
  const truncated = createScreen([change, createReplayTruncatedEvent(2)]);
  const malformed = createScreen([change, { type: 5, timestamp: 2, data: { tag: REPLAY_TRUNCATED_EVENT_TAG, payload: null } }]);

  expect(isCapturedScreen(truncated)).toBe(true);
  expect(isReplayTruncated(truncated.events as ScreenSnapshotEvent[])).toBe(true);
  expect(isReplayTruncated(createScreen([change]).events as ScreenSnapshotEvent[])).toBe(false);
  expect(isCapturedScreen(malformed)).toBe(false);
  expect(isReplayTruncated(malformed.events as ScreenSnapshotEvent[])).toBe(false);
});

it('accepts a Flow that went through several documents, in the SDK guard and on the server, and plays it', () => {
  const nextPage = (createScreenSnapshotBody().events as ScreenSnapshotEvent[]).map((event) => ({ ...event, timestamp: 5 }));
  const flow = createScreen([{ type: 3, timestamp: 2, data: { source: 2 } }, ...nextPage, createReplayTruncatedEvent(5)]);
  const pagesOnly = createScreen(nextPage);

  expect(isCapturedScreen(flow)).toBe(true);
  expect(createScreenSnapshotInputSchema.safeParse(flow).success).toBe(true);
  expect(isCapturedScreen(pagesOnly)).toBe(true);
  expect(createScreenSnapshotInputSchema.safeParse(pagesOnly).success).toBe(true);
  expect(hasReplayEvents(pagesOnly.events as ScreenSnapshotEvent[])).toBe(true);
});
