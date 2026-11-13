import { expect, it } from 'vitest';
import { createCommentPins, createEditMoves } from '@/sdk/screen-marks';

function createElement(isConnected: boolean, left = 10, top = 20, width = 80) {
  return { isConnected, getBoundingClientRect: () => ({ left, top, width, height: width === 0 ? 0 : 30 }) } as unknown as Element;
}

const OFFSET = { x: 0.25, y: 0.5 };

it('pins connected, rendered elements in document coordinates and keeps their rrweb node id', () => {
  const kept = createElement(true);
  const unserialized = createElement(true, 0, 0);
  const pins = createCommentPins(
    [
      { number: 1, key: 'comment-1', label: 'save', comment: 'first', offset: OFFSET, element: kept },
      { number: 2, key: 'comment-2', label: 'gone', comment: 'removed', offset: OFFSET, element: createElement(false) },
      { number: 4, key: 'comment-4', label: 'modal', comment: 'hidden', offset: OFFSET, element: createElement(true, 0, 0, 0) },
      { number: 3, key: 'comment-3', label: 'div', comment: 'third', offset: OFFSET, element: unserialized },
    ],
    { findNodeId: (element) => (element === kept ? 7 : -1), scrollX: 5, scrollY: 100 },
  );

  expect(pins).toEqual([
    { number: 1, key: 'comment-1', nodeId: 7, rect: { x: 15, y: 120, width: 80, height: 30 }, offset: OFFSET, label: 'save', comment: 'first' },
    { number: 3, key: 'comment-3', nodeId: null, rect: { x: 5, y: 100, width: 80, height: 30 }, offset: OFFSET, label: 'div', comment: 'third' },
  ]);
});

it('keeps the recorded rects of a move and adds the node id of the dragged element', () => {
  const dragged = createElement(true);
  const rects = { originalRect: { x: 1, y: 2, width: 3, height: 4 }, proposedRect: { x: 51, y: 2, width: 3, height: 4 } };
  const moves = createEditMoves(
    [
      { number: 1, key: 'edit-1', label: 'save', element: dragged, ...rects },
      { number: 2, key: 'edit-2', label: 'gone', element: createElement(false), ...rects },
      { number: 3, key: 'edit-3', label: 'modal', element: createElement(true, 0, 0, 0), ...rects },
    ],
    (element) => (element === dragged ? 4 : -1),
  );

  expect(moves).toEqual([{ number: 1, key: 'edit-1', nodeId: 4, label: 'save', ...rects }]);
});
