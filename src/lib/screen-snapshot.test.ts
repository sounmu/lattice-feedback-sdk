import { expect, it } from 'vitest';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { createCommentPinEvent, findCommentPins, isCapturedScreen, reconcileCommentPins } from '@/lib/screen-snapshot';
import type { ScreenCommentPin, ScreenSnapshotEvent } from '@/types/screen-snapshot';

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
    { type: 3, timestamp: 1, data: {} },
  ];
  for (const event of malformed) {
    expect(isCapturedScreen(createScreen([event]))).toBe(false);
  }
  expect(findCommentPins(malformed as ScreenSnapshotEvent[])).toEqual([]);
});

it('drops the pins of deleted comments from a saved screen and renumbers the rest', () => {
  const events = createScreen([
    createCommentPinEvent(PIN, 1),
    createCommentPinEvent({ ...PIN, number: 2, key: 'comment-2' }, 1),
    createCommentPinEvent({ ...PIN, number: 3, key: 'comment-3' }, 1),
  ]).events as ScreenSnapshotEvent[];

  const kept = reconcileCommentPins(events, ['comment-1', 'comment-2', 'comment-3']);
  const updated = reconcileCommentPins(events, ['comment-2', 'comment-3']) ?? [];

  expect(kept).toBe(events);
  expect(findCommentPins(updated).map(({ key, number }) => [key, number])).toEqual([['comment-2', 1], ['comment-3', 2]]);
  expect(updated.slice(0, 2)).toEqual(events.slice(0, 2));
  expect(reconcileCommentPins(events, ['comment-9'])).toBeNull();
});
