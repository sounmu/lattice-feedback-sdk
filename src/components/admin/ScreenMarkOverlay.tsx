'use client';

import { getBubbleShift } from '@/lib/screen-preview';
import type { ScreenCommentPin, ScreenEditMove } from '@/types/screen-snapshot';

/** Where a pin's element sits in the rebuilt page's viewport, in CSS px. */
export interface PinBox {
  pin: ScreenCommentPin;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The clicked point lies outside a scroll container or other clipping ancestor of its element. */
  isClipped: boolean;
}

// Bubble width in screen px, before the inverse scale is applied.
const BUBBLE_WIDTH = 256;
// Screen px a bubble held in view keeps to the edge of the screen.
const BUBBLE_EDGE_GAP = 8;

/** Class names of the pieces drawn for a pin. The bubble has to stay BUBBLE_WIDTH wide. */
export interface CommentPinOverlaySkin {
  target: string;
  selectedTarget: string;
  badge: string;
  bubble: string;
  label: string;
  comment: string;
}

export interface CommentPinOverlayProps {
  boxes: PinBox[];
  /** Size of the rebuilt page's viewport; pins scrolled out of it are not drawn. */
  width: number;
  height: number;
  scale: number;
  selectedNumber: number | null;
  onSelect: (number: number | null) => void;
  /**
   * Starts an open comment left of its pin by as much as it takes to end inside the screen. Without it the
   * comment opens to the right of its pin, or wholly to the left when the right has no room, which cuts it
   * off on a screen too narrow for either.
   */
  keepsBubbleInView?: boolean;
}

// Drawn over the rebuilt page in its own coordinates. Badges and bubbles are scaled back up so they
// stay readable when the screen is shrunk to fit.
export function CommentPinOverlay({
  boxes, width: viewWidth, height: viewHeight, scale, selectedNumber, onSelect, skin, keepsBubbleInView = false,
}: CommentPinOverlayProps & { skin: CommentPinOverlaySkin }) {
  const inverseScale = 1 / scale;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {boxes.map(({ pin, x, y, width, height, isClipped }) => {
        const isSelected = pin.number === selectedNumber;
        // The badge stays on the clicked point; a point scrolled out of view hides the badge rather
        // than moving it over unrelated content.
        const badgeX = x + pin.offset.x * width;
        const badgeY = y + pin.offset.y * height;
        if (isClipped || badgeX < 0 || badgeY < 0 || badgeX > viewWidth || badgeY > viewHeight) {
          return null;
        }
        const opensLeft = badgeX + BUBBLE_WIDTH * inverseScale > viewWidth;
        const bubbleShift = getBubbleShift({ pinX: badgeX, viewWidth, scale, bubbleWidth: BUBBLE_WIDTH, edgeGap: BUBBLE_EDGE_GAP });
        return (
          <div key={pin.number}>
            <div
              className={`absolute ${isSelected ? skin.selectedTarget : skin.target}`}
              style={{ left: x, top: y, width, height }}
            />
            <div className="absolute" style={{ left: badgeX, top: badgeY, transform: `scale(${inverseScale})`, transformOrigin: 'top left' }}>
              <button
                type="button"
                aria-label={`코멘트 ${pin.number}`}
                aria-pressed={isSelected}
                className={`pointer-events-auto -translate-x-1/2 -translate-y-1/2 ${skin.badge}`}
                onClick={() => onSelect(isSelected ? null : pin.number)}
              >
                {pin.number}
              </button>
              {isSelected && (
                <div
                  role="note"
                  className={`pointer-events-auto ${skin.bubble} ${opensLeft && !keepsBubbleInView ? '-translate-x-full' : ''}`}
                  style={keepsBubbleInView ? { translate: `${-bubbleShift}px 0` } : undefined}
                >
                  <p className={skin.label}>{pin.label}</p>
                  <p className={skin.comment}>{pin.comment}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface CommentPinListProps {
  pins: ScreenCommentPin[];
  selectedNumber: number | null;
  onSelect: (number: number | null) => void;
}

export interface MoveBox {
  move: ScreenEditMove;
  original: { x: number; y: number; width: number; height: number };
  proposed: { x: number; y: number; width: number; height: number };
  /** Clockwise degrees the proposed box is turned around its centre. */
  rotation: number;
}

/** Class names of the outlines drawn for an edit. Each position has one look while the element is drawn there and one while it is not. */
export interface EditMoveOverlaySkin {
  original: string;
  vacatedOriginal: string;
  proposed: string;
  shownProposed: string;
  label: string;
}

export interface EditMoveOverlayProps {
  boxes: MoveBox[];
  scale: number;
  showsProposed: boolean;
}

// The original position stays outlined with a dashed line and the proposed one with a solid line,
// so both are visible whichever position the element is currently drawn at.
export function EditMoveOverlay({ boxes, scale, showsProposed, skin }: EditMoveOverlayProps & { skin: EditMoveOverlaySkin }) {
  const inverseScale = 1 / scale;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {boxes.map(({ move, original, proposed, rotation }) => (
        <div key={move.number}>
          <div
            className={`absolute ${showsProposed ? skin.vacatedOriginal : skin.original}`}
            style={{ left: original.x, top: original.y, width: original.width, height: original.height }}
          />
          <div
            className={`absolute ${showsProposed ? skin.shownProposed : skin.proposed}`}
            style={{
              left: proposed.x,
              top: proposed.y,
              width: proposed.width,
              height: proposed.height,
              transform: rotation === 0 ? undefined : `rotate(${rotation}deg)`,
            }}
          />
          <span
            className={`absolute ${skin.label}`}
            style={{ left: proposed.x, top: proposed.y, transform: `scale(${inverseScale}) translateY(-100%)`, transformOrigin: 'top left' }}
          >
            편집 {move.number}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface EditMoveListProps {
  moves: ScreenEditMove[];
  showsProposed: boolean;
  onToggle: () => void;
}
