import type { ElementRect } from '@/types/feedback';

export interface ComparisonBounds {
  width: number;
  height: number;
}

export interface MoveDescription {
  /** How far the element's centre moved, so a scaled element that stays put reads as not moved. */
  deltaX: number;
  deltaY: number;
  /** Proposed size over original size, 1 when unchanged. */
  scaleX: number;
  scaleY: number;
  /** Clockwise degrees, 0 when unrotated. */
  rotation: number;
  isResized: boolean;
}

/** A proposed rotation is stored between -180 and 180 degrees. */
export const MAX_EDIT_ROTATION = 180;

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

export function normalizeRotation(degrees: number): number {
  const turned = ((((degrees + MAX_EDIT_ROTATION) % 360) + 360) % 360) - MAX_EDIT_ROTATION;
  // -180 and 180 are the same angle; one spelling keeps stored values comparable. `+ 0` drops a -0.
  return (turned === -MAX_EDIT_ROTATION ? MAX_EDIT_ROTATION : turned) + 0;
}

export function isEditRotation(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_EDIT_ROTATION;
}

function getScale(proposed: number, original: number): number {
  return original > 0 ? proposed / original : 1;
}

export function describeMove(originalRect: ElementRect, proposedRect: ElementRect, rotation = 0): MoveDescription {
  return {
    deltaX: Math.round(proposedRect.x + proposedRect.width / 2 - (originalRect.x + originalRect.width / 2)),
    deltaY: Math.round(proposedRect.y + proposedRect.height / 2 - (originalRect.y + originalRect.height / 2)),
    scaleX: getScale(proposedRect.width, originalRect.width),
    scaleY: getScale(proposedRect.height, originalRect.height),
    rotation: normalizeRotation(rotation),
    isResized: originalRect.width !== proposedRect.width || originalRect.height !== proposedRect.height,
  };
}

function formatPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

function formatScale({ scaleX, scaleY }: MoveDescription): string {
  if (formatPercent(scaleX) === formatPercent(scaleY)) {
    return `크기 ${formatPercent(scaleX)}`;
  }
  return `크기 가로 ${formatPercent(scaleX)}, 세로 ${formatPercent(scaleY)}`;
}

function formatRotation(rotation: number): string {
  if (rotation > 0) {
    return `시계 방향 ${Math.round(rotation)}° 회전`;
  }
  return `반시계 방향 ${Math.round(-rotation)}° 회전`;
}

/** One line for everything an edit changes, such as "가로 +40px, 세로 0px 이동 · 크기 120% · 시계 방향 15° 회전". */
export function formatEditChange(move: MoveDescription): string {
  const parts: string[] = [];
  if (move.deltaX !== 0 || move.deltaY !== 0) {
    parts.push(`가로 ${formatSignedPixels(move.deltaX)}, 세로 ${formatSignedPixels(move.deltaY)} 이동`);
  }
  if (move.isResized) {
    parts.push(formatScale(move));
  }
  if (move.rotation !== 0) {
    parts.push(formatRotation(move.rotation));
  }
  if (parts.length === 0) {
    return '제자리';
  }
  return parts.join(' · ');
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
