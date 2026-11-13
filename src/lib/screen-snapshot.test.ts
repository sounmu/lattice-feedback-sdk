import { expect, it } from 'vitest';
import { createScreenSnapshotBody } from '@/app/api/snapshots/screen-snapshot-test-fixtures';
import { createCommentPinEvent, findCommentPins, isCapturedScreen } from '@/lib/screen-snapshot';
import type { ScreenCommentPin, ScreenSnapshotEvent } from '@/types/screen-snapshot';

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
