'use client';

import type { ScreenCommentPin } from '@/types/screen-snapshot';

/** Where a pin's element sits in the rebuilt page's viewport, in CSS px. */
export interface PinBox {
  pin: ScreenCommentPin;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Badge radius and bubble width in screen px, before the inverse scale is applied.
const BADGE_RADIUS = 14;
const BUBBLE_WIDTH = 256;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

interface CommentPinOverlayProps {
  boxes: PinBox[];
  /** Size of the rebuilt page's viewport, so badges and bubbles stay inside it. */
  width: number;
  height: number;
  scale: number;
  selectedNumber: number | null;
  onSelect: (number: number | null) => void;
}

// Drawn over the rebuilt page in its own coordinates. Badges and bubbles are scaled back up so they
// stay readable when the screen is shrunk to fit.
export function CommentPinOverlay({ boxes, width: viewWidth, height: viewHeight, scale, selectedNumber, onSelect }: CommentPinOverlayProps) {
  const inverseScale = 1 / scale;
  const badgeRadius = BADGE_RADIUS * inverseScale;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {boxes.map(({ pin, x, y, width, height }) => {
        const isSelected = pin.number === selectedNumber;
        const badgeX = clamp(x + pin.offset.x * width, badgeRadius, viewWidth - badgeRadius);
        const badgeY = clamp(y + pin.offset.y * height, badgeRadius, viewHeight - badgeRadius);
        const opensLeft = badgeX + BUBBLE_WIDTH * inverseScale > viewWidth;
        return (
          <div key={pin.number}>
            <div
              className={`absolute rounded border-2 ${isSelected ? 'border-blue-600 bg-blue-600/10' : 'border-blue-500/70'}`}
              style={{ left: x, top: y, width, height }}
            />
            <div className="absolute" style={{ left: badgeX, top: badgeY, transform: `scale(${inverseScale})`, transformOrigin: 'top left' }}>
              <button
                type="button"
                aria-label={`코멘트 ${pin.number}`}
                aria-pressed={isSelected}
                className="pointer-events-auto -translate-x-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full rounded-bl-none bg-blue-600 text-xs font-semibold text-white shadow"
                onClick={() => onSelect(isSelected ? null : pin.number)}
              >
                {pin.number}
              </button>
              {isSelected && (
                <div
                  role="note"
                  className={`pointer-events-auto mt-1 w-64 rounded border bg-white p-2 text-xs text-gray-900 shadow-lg ${opensLeft ? '-translate-x-full' : ''}`}
                >
                  <p className="font-medium text-gray-600">{pin.label}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{pin.comment}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface CommentPinListProps {
  pins: ScreenCommentPin[];
  selectedNumber: number | null;
  onSelect: (number: number | null) => void;
}

export function CommentPinList({ pins, selectedNumber, onSelect }: CommentPinListProps) {
  return (
    <ol aria-label={`코멘트 ${pins.length}개`} className="flex flex-col gap-2">
      {pins.map((pin) => (
        <li key={pin.number}>
          <button
            type="button"
            aria-pressed={pin.number === selectedNumber}
            className="flex w-full items-start gap-2 rounded border bg-white p-2 text-left text-sm aria-pressed:border-blue-600"
            onClick={() => onSelect(pin.number === selectedNumber ? null : pin.number)}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
              {pin.number}
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-gray-600">{pin.label}</span>
              <span className="block whitespace-pre-wrap break-words">{pin.comment}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
