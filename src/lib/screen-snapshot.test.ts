import { expect, it } from 'vitest';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { createCommentPinEvent, createEditMoveEvent, findCommentPins, findEditMoves, isCapturedScreen } from '@/lib/screen-snapshot';
import type { ScreenCommentPin, ScreenEditMove, ScreenSnapshotEvent } from '@/types/screen-snapshot';

const PIN: ScreenCommentPin = { number: 1, nodeId: 7, rect: { x: 10, y: 20, width: 80, height: 30 }, label: 'save', comment: '버튼이 안 보여요' };

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
    { type: 5, timestamp: 1, data: { tag: 'other', payload: PIN } },
    { type: 3, timestamp: 1, data: {} },
  ];
  for (const event of malformed) {
    expect(isCapturedScreen(createScreen([event]))).toBe(false);
  }
  expect(findCommentPins(malformed as ScreenSnapshotEvent[])).toEqual([]);
});

it('accepts proposed moves next to comment pins and reads each kind separately', () => {
  const move: ScreenEditMove = {
    number: 1,
    nodeId: 9,
    originalRect: { x: 10, y: 20, width: 80, height: 30 },
    proposedRect: { x: 110, y: -20, width: 80, height: 30 },
    label: 'save',
  };
  const screen = createScreen([createCommentPinEvent(PIN, 1), createEditMoveEvent(move, 1)]);
  const events = screen.events as ScreenSnapshotEvent[];

  expect(isCapturedScreen(screen)).toBe(true);
  expect(findEditMoves(events)).toEqual([move]);
  expect(findCommentPins(events)).toEqual([PIN]);
  expect(isCapturedScreen(createScreen([createEditMoveEvent({ ...move, number: 11 }, 1)]))).toBe(false);
  expect(isCapturedScreen(createScreen([createEditMoveEvent({ ...move, proposedRect: { x: 0, y: 0, width: -1, height: 0 } }, 1)]))).toBe(false);
});
