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

const PIN_OVERLAY_SKIN: CommentPinOverlaySkin = {
  target: 'rounded border-2 border-blue-500/70',
  selectedTarget: 'rounded border-2 border-blue-600 bg-blue-600/10',
  badge: 'flex h-7 w-7 items-center justify-center rounded-full rounded-bl-none bg-blue-600 text-xs font-semibold text-white shadow',
  bubble: 'mt-1 w-64 rounded-xl border bg-white p-2 text-xs text-gray-900 shadow-lg',
  label: 'font-medium text-gray-600',
  comment: 'mt-1 whitespace-pre-wrap break-words',
};

export interface CommentPinOverlayProps {
  boxes: PinBox[];
  /** Size of the rebuilt page's viewport; pins scrolled out of it are not drawn. */
  width: number;
  height: number;
  scale: number;
  selectedNumber: number | null;
  onSelect: (number: number | null) => void;
  /** A host with its own look passes its own class names. The default is this viewer's look. */
  skin?: CommentPinOverlaySkin;
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
  boxes, width: viewWidth, height: viewHeight, scale, selectedNumber, onSelect, skin = PIN_OVERLAY_SKIN, keepsBubbleInView = false,
}: CommentPinOverlayProps) {
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

export function CommentPinList({ pins, selectedNumber, onSelect }: CommentPinListProps) {
  return (
    <ol aria-label={`코멘트 ${pins.length}개`} className="flex flex-col gap-2">
      {pins.map((pin) => (
        <li key={pin.number}>
          <button
            type="button"
            aria-pressed={pin.number === selectedNumber}
            className="flex w-full items-start gap-2 rounded-xl border bg-white p-2 text-left text-sm aria-pressed:border-blue-600"
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

/** An element's original and proposed box in the rebuilt page's viewport, in CSS px. */
export interface MoveBox {
  move: ScreenEditMove;
  original: { x: number; y: number; width: number; height: number };
  proposed: { x: number; y: number; width: number; height: number };
}

/** Class names of the outlines drawn for an edit. Each position has one look while the element is drawn there and one while it is not. */
export interface EditMoveOverlaySkin {
  original: string;
  vacatedOriginal: string;
  proposed: string;
  shownProposed: string;
  label: string;
}

const MOVE_OVERLAY_SKIN: EditMoveOverlaySkin = {
  original: 'rounded border-2 border-dashed border-orange-500 bg-orange-500/10',
  vacatedOriginal: 'rounded border-2 border-dashed border-gray-500',
  proposed: 'rounded border-2 border-emerald-600/70',
  shownProposed: 'rounded border-2 border-emerald-600 bg-emerald-600/10',
  label: 'rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-semibold text-white shadow',
};

export interface EditMoveOverlayProps {
  boxes: MoveBox[];
  scale: number;
  showsProposed: boolean;
  /** A host with its own look passes its own class names. The default is this viewer's look. */
  skin?: EditMoveOverlaySkin;
}

// The original position stays outlined with a dashed line and the proposed one with a solid line,
// so both are visible whichever position the element is currently drawn at.
export function EditMoveOverlay({ boxes, scale, showsProposed, skin = MOVE_OVERLAY_SKIN }: EditMoveOverlayProps) {
  const inverseScale = 1 / scale;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {boxes.map(({ move, original, proposed }) => (
        <div key={move.number}>
          <div
            className={`absolute ${showsProposed ? skin.vacatedOriginal : skin.original}`}
            style={{ left: original.x, top: original.y, width: original.width, height: original.height }}
          />
          <div
            className={`absolute ${showsProposed ? skin.shownProposed : skin.proposed}`}
            style={{ left: proposed.x, top: proposed.y, width: proposed.width, height: proposed.height }}
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

function formatDelta(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export interface EditMoveListProps {
  moves: ScreenEditMove[];
  showsProposed: boolean;
  onToggle: () => void;
}

export function EditMoveList({ moves, showsProposed, onToggle }: EditMoveListProps) {
  return (
    <section aria-label={`위치 편집 ${moves.length}개`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={showsProposed}
          className="min-h-11 rounded-[10px] border bg-white px-3 py-2 text-sm aria-pressed:bg-emerald-700 aria-pressed:text-white"
          onClick={onToggle}
        >
          {showsProposed ? '원래 위치로 보기' : '제안 위치로 보기'}
        </button>
        <span className="text-xs text-gray-600">
          점선은 원래 위치, 실선은 제안 위치입니다. 좌표 이동 제안이며 실제 레이아웃 코드 변경과 같지 않습니다.
        </span>
      </div>
      <ol className="flex flex-col gap-1 text-sm">
        {moves.map((move) => (
          <li key={move.number} className="rounded-xl border bg-white p-2">
            <span className="font-medium">편집 {move.number}</span> · {move.label} · 가로{' '}
            {formatDelta(move.proposedRect.x - move.originalRect.x)}px, 세로 {formatDelta(move.proposedRect.y - move.originalRect.y)}px
          </li>
        ))}
      </ol>
    </section>
  );
}
