import { MAX_COMMENT_LENGTH, truncateText } from '@/lib/feedback-limits';
import { MAX_LABEL_LENGTH } from '@/lib/screen-snapshot';
import type { ScreenCommentPin, ScreenEditMove } from '@/types/screen-snapshot';

/** A comment to pin on the saved screen, with the live element it was written for. */
export interface CommentPinSource extends Pick<ScreenCommentPin, 'number' | 'key' | 'label' | 'comment' | 'offset'> {
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

// Elements removed or hidden (a closed modal kept with display: none) since the comment was written have
// nothing to point at on this screen, so they are skipped and keep the screen that showed them.
export function createCommentPins(sources: readonly CommentPinSource[], position: PinPosition): ScreenCommentPin[] {
  return sources
    .map((source) => ({ source, bounds: source.element.getBoundingClientRect() }))
    .filter(({ source, bounds }) => source.element.isConnected && bounds.width > 0 && bounds.height > 0)
    .map(({ source: { element, number, key, label, comment, offset }, bounds }) => {
      const nodeId = position.findNodeId(element);
      return {
        number,
        key,
        nodeId: nodeId >= 0 ? nodeId : null,
        rect: { x: bounds.left + position.scrollX, y: bounds.top + position.scrollY, width: bounds.width, height: bounds.height },
        offset,
        label: truncateText(label, MAX_LABEL_LENGTH),
        comment: truncateText(comment, MAX_COMMENT_LENGTH),
      };
    });
}

// The rects were recorded in document coordinates when the drag ended, so only the node id is added here.
// Like comments, an edited element removed or hidden since (a closed modal kept with display: none) is left
// out, so the screen that showed it is not replaced by one where it cannot be seen.
export function createEditMoves(sources: readonly EditMoveSource[], findNodeId: (element: Element) => number): ScreenEditMove[] {
  return sources
    .filter(({ element }) => {
      const bounds = element.getBoundingClientRect();
      return element.isConnected && bounds.width > 0 && bounds.height > 0;
    })
    .map(({ element, number, key, label, originalRect, proposedRect }) => {
      const nodeId = findNodeId(element);
      return { number, key, nodeId: nodeId >= 0 ? nodeId : null, originalRect, proposedRect, label: truncateText(label, MAX_LABEL_LENGTH) };
    });
}
