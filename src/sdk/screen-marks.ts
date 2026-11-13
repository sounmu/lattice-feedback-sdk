import { MAX_COMMENT_LENGTH, truncateText } from '@/lib/feedback-limits';
import { MAX_LABEL_LENGTH } from '@/lib/screen-snapshot';
import type { ScreenCommentPin, ScreenEditMove } from '@/types/screen-snapshot';

/** A comment to pin on the saved screen, with the live element it was written for. */
export interface CommentPinSource extends Pick<ScreenCommentPin, 'number' | 'key' | 'label' | 'comment'> {
  element: Element;
}

/** A proposed move to show on the saved screen, with the live element that was dragged. */
export interface EditMoveSource extends Pick<ScreenEditMove, 'number' | 'key' | 'label' | 'originalRect' | 'proposedRect'> {
  element: Element;
}

interface PinPosition {
  /** rrweb node id, or a negative number when the element was not serialized. */
  findNodeId: (element: Element) => number;
  scrollX: number;
  scrollY: number;
}

// Elements removed from the page since the comment was written have nothing to point at, so they are skipped.
export function createCommentPins(sources: readonly CommentPinSource[], position: PinPosition): ScreenCommentPin[] {
  return sources
    .filter(({ element }) => element.isConnected)
    .map(({ element, number, key, label, comment }) => {
      const bounds = element.getBoundingClientRect();
      const nodeId = position.findNodeId(element);
      return {
        number,
        key,
        nodeId: nodeId >= 0 ? nodeId : null,
        rect: { x: bounds.left + position.scrollX, y: bounds.top + position.scrollY, width: bounds.width, height: bounds.height },
        label: truncateText(label, MAX_LABEL_LENGTH),
        comment: truncateText(comment, MAX_COMMENT_LENGTH),
      };
    });
}

// The rects were recorded in document coordinates when the drag ended, so only the node id is added here.
export function createEditMoves(sources: readonly EditMoveSource[], findNodeId: (element: Element) => number): ScreenEditMove[] {
  return sources
    .filter(({ element }) => element.isConnected)
    .map(({ element, number, key, label, originalRect, proposedRect }) => {
      const nodeId = findNodeId(element);
      return { number, key, nodeId: nodeId >= 0 ? nodeId : null, originalRect, proposedRect, label: truncateText(label, MAX_LABEL_LENGTH) };
    });
}
