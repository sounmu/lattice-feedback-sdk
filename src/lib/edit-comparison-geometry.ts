import type { ElementRect } from '@/types/feedback';

export interface ComparisonBounds {
  width: number;
  height: number;
}

export interface MoveDescription {
  deltaX: number;
  deltaY: number;
  isResized: boolean;
}

const MINIMUM_BOUND = 1;

/**
 * The drawing area for a before/after comparison. It is at least the reporter's viewport and
 * grows to include any rectangle that lies outside it, such as an element below the fold.
 */
export function getComparisonBounds(viewportWidth: number, viewportHeight: number, rects: ElementRect[]): ComparisonBounds {
  let width = Math.max(viewportWidth, MINIMUM_BOUND);
  let height = Math.max(viewportHeight, MINIMUM_BOUND);
  for (const rect of rects) {
    width = Math.max(width, rect.x + rect.width);
    height = Math.max(height, rect.y + rect.height);
  }
  return { width, height };
}

export function describeMove(originalRect: ElementRect, proposedRect: ElementRect): MoveDescription {
  return {
    deltaX: Math.round(proposedRect.x - originalRect.x),
    deltaY: Math.round(proposedRect.y - originalRect.y),
    isResized: originalRect.width !== proposedRect.width || originalRect.height !== proposedRect.height,
  };
}

export function formatSignedPixels(value: number): string {
  if (value > 0) {
    return `+${value}px`;
  }
  return `${value}px`;
}

export function formatRect(rect: ElementRect): string {
  return `${Math.round(rect.x)}, ${Math.round(rect.y)} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}
