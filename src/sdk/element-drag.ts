// Edit mode engine (AGENTS.md section 3, Edit): the user drags an isolated ghost
// that stands in for the selected element. The original element, its styles, and
// any framework state are never written to; only the ghost overlay moves.
//
// Data minimization (AGENTS.md section 5): the ghost is a neutral replica built
// from the element's bounds and the policy-configured id. No host text, HTML,
// attributes, or input values are copied into the overlay or the payload.
//
// Size and angle: a corner handle scales the ghost around its centre and a handle above it rotates it
// around the centre. The proposal is a visual change request, so the size is a scale of the element,
// never a new layout width.
//
// Viewport freeze: the ghost is position: fixed and coordinates are converted to
// document CSS px once at start. Any resize or scroll (including nested
// scrollers, observed in the capture phase) would invalidate that mapping, so it
// cancels the active edit instead of trying to re-project positions.
import { normalizeRotation } from '@/lib/edit-comparison-geometry';
import { describeTarget } from '@/lib/target-labels';
import type { CaptureTarget } from '@/sdk/capture-policy';
import { SDK_Z_INDEX } from '@/sdk/styles';
import {
  getStateLayer, getTranslucentColor, SDK_BUTTON_BASE, SDK_FOCUS_OUTLINE, SDK_FONT_FAMILY, SDK_HOVER_MEDIA, SDK_NO_TAP_HIGHLIGHT,
  SDK_PRESSED_SCALE, SDK_RADIUS, SDK_SHADOW, SDK_THEME, SDK_THEME_DARK,
} from '@/sdk/theme-tokens';
import type { EditAttachment, ElementRect } from '@/types/feedback';

export interface ElementDragOptions {
  onComplete: (attachment: EditAttachment) => void;
  onCancel: () => void;
}

export interface ElementDragHandle {
  cancel(): void;
}

const EDIT_OVERLAY_ATTRIBUTE = 'data-lattice-overlay';
const EDIT_OVERLAY_VALUE = 'edit';
const CONFIRM_LABEL = '변경 첨부';
const CANCEL_LABEL = '취소';
const TOOLBAR_LABEL = '위치 편집';
const GHOST_LABEL_SUFFIX =
  ' 편집 미리보기: 끌거나 방향키로 옮기고, 모서리나 +·- 키로 크기, 위 손잡이나 [·] 키로 회전해요. Enter로 첨부해요';
const TOOLBAR_GAP = 8;
const VIEWPORT_EDGE = 8;
const KEYBOARD_STEP = 8;
const KEYBOARD_SCALE_STEP = 0.1;
const ROTATION_STEP = 15;
const MIN_GHOST_SIZE = 16;
const MAX_SCALE = 4;
const HANDLE_SIZE = 18;
// The rotate handle sits this far above the ghost's top edge, so it never covers the element.
const ROTATE_HANDLE_OFFSET = 28;
const GUARDED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'beforeinput', 'keydown', 'keyup'] as const;
const INTERACTION_CAPTURE: AddEventListenerOptions = { capture: true, passive: false };

const OVERLAY_ROOT_STYLE = `position: fixed; inset: 0; z-index: ${SDK_Z_INDEX}; pointer-events: none; margin: 0; padding: 0;`;
const GHOST_STYLE = [
  'position: fixed',
  'box-sizing: border-box',
  'margin: 0',
  'padding: 4px',
  `border: 2px dashed ${SDK_THEME.info}`,
  `border-radius: ${SDK_RADIUS.inner}`,
  `background: ${getTranslucentColor(SDK_THEME.info, 0.18)}`,
  `color: ${SDK_THEME.onInfoMuted}`,
  `font: 500 12px/1.2 ${SDK_FONT_FAMILY}`,
  'overflow: visible',
  'transform-origin: 50% 50%',
  'cursor: grab',
  'user-select: none',
  'touch-action: none',
  'pointer-events: auto',
  'outline: none',
  SDK_NO_TAP_HIGHLIGHT,
].join('; ');
const GHOST_TEXT_STYLE = 'display: block; width: 100%; height: 100%; overflow: hidden; pointer-events: none';
const HANDLE_STYLE = [
  'position: absolute',
  'box-sizing: border-box',
  `width: ${HANDLE_SIZE}px`,
  `height: ${HANDLE_SIZE}px`,
  'border-radius: 50%',
  `border: 2px solid ${SDK_THEME.info}`,
  `background: ${SDK_THEME.surface}`,
  'touch-action: none',
  'pointer-events: auto',
].join('; ');
const RESIZE_HANDLE_STYLE = `${HANDLE_STYLE}; right: ${-HANDLE_SIZE / 2}px; bottom: ${-HANDLE_SIZE / 2}px; cursor: nwse-resize`;
const ROTATE_HANDLE_STYLE = `${HANDLE_STYLE}; left: calc(50% - ${HANDLE_SIZE / 2}px); top: ${-ROTATE_HANDLE_OFFSET}px; cursor: grab`;
const TOOLBAR_STYLE = [
  'position: fixed',
  'left: 0',
  'top: 0',
  'display: flex',
  'gap: 8px',
  'padding: 8px',
  `border-radius: ${SDK_RADIUS.container}`,
  `background: ${SDK_THEME_DARK.surface}`,
  `box-shadow: ${SDK_SHADOW.high}`,
  'pointer-events: auto',
].join('; ');
// The toolbar is a dark bar like the mode bar, so its buttons take the theme's dark values.
const BUTTON_STYLE = `all: initial; display: inline-flex; align-items: center; justify-content: center; ${SDK_BUTTON_BASE}`;
const CONFIRM_BUTTON_STYLE = `${BUTTON_STYLE}; background-color: ${SDK_THEME_DARK.accent}; color: ${SDK_THEME_DARK.onAccent};`;
const CANCEL_BUTTON_STYLE = `${BUTTON_STYLE}; background-color: ${SDK_THEME_DARK.neutral}; color: ${SDK_THEME_DARK.textPrimary};`;
// Inline styles cannot express focus, hover or pressed states, so the overlay carries one attribute-scoped
// rule set. The ghost sits on the customer's page: a light halo inside its outline keeps the ring visible
// on dark pages too.
const OVERLAY_SELECTOR = `[${EDIT_OVERLAY_ATTRIBUTE}="${EDIT_OVERLAY_VALUE}"]`;
const STATE_STYLES = `
${OVERLAY_SELECTOR} [role="button"]:focus-visible {
  outline: ${SDK_FOCUS_OUTLINE.line} ${SDK_THEME.accent} !important;
  outline-offset: ${SDK_FOCUS_OUTLINE.offset} !important;
  box-shadow: 0 0 0 ${SDK_FOCUS_OUTLINE.offset} ${SDK_THEME.surface} !important;
}
${OVERLAY_SELECTOR} button:focus-visible {
  outline: ${SDK_FOCUS_OUTLINE.line} ${SDK_THEME_DARK.accent} !important;
  outline-offset: ${SDK_FOCUS_OUTLINE.offset} !important;
}
${SDK_HOVER_MEDIA} {
  ${OVERLAY_SELECTOR} button:hover { background-image: ${getStateLayer(SDK_THEME_DARK.overlayHover)} !important; }
}
${OVERLAY_SELECTOR} button:active {
  background-image: ${getStateLayer(SDK_THEME_DARK.overlayPressed)} !important;
  transform: ${SDK_PRESSED_SCALE} !important;
}
${SDK_HOVER_MEDIA} {
  ${OVERLAY_SELECTOR} button[data-action="confirm"]:hover { background-image: ${getStateLayer(SDK_THEME_DARK.accentHover)} !important; }
}
${OVERLAY_SELECTOR} button[data-action="confirm"]:active { background-image: ${getStateLayer(SDK_THEME_DARK.accentPressed)} !important; }
@media (prefers-reduced-motion: reduce) {
  ${OVERLAY_SELECTOR} button { transition: none !important; }
  ${OVERLAY_SELECTOR} button:active { transform: none !important; }
}
`;

type DragKind = 'move' | 'resize' | 'rotate';

interface DragState {
  kind: DragKind;
  pointerId: number;
  startX: number;
  startY: number;
  startCenterX: number;
  startCenterY: number;
}

let activeHandle: ElementDragHandle | null = null;

function clamp(value: number, size: number, viewportSize: number): number {
  // Keep the ghost fully on screen when it fits; otherwise keep it covering the viewport.
  const limit = viewportSize - size;
  return Math.min(Math.max(value, Math.min(0, limit)), Math.max(0, limit));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// The screen box a rotated ghost covers, which is what has to stay on screen.
function getRotatedBox(width: number, height: number, rotation: number): { width: number; height: number } {
  const cos = Math.abs(Math.cos(toRadians(rotation)));
  const sin = Math.abs(Math.sin(toRadians(rotation)));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

function findHandleKind(target: EventTarget | null): DragKind {
  const kind = (target as { getAttribute?: (name: string) => string | null } | null)?.getAttribute?.('data-handle');
  if (kind === 'resize' || kind === 'rotate') {
    return kind;
  }
  return 'move';
}

function blockEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

export function startElementDrag(selection: CaptureTarget, options: ElementDragOptions): ElementDragHandle {
  activeHandle?.cancel();

  const bounds = selection.element.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const originalRect: ElementRect = {
    x: bounds.left + scrollX,
    y: bounds.top + scrollY,
    width: bounds.width,
    height: bounds.height,
  };
  // A zero-sized element still gets a ghost that can be grabbed; the size limits never shrink below it.
  const minimumWidth = Math.min(MIN_GHOST_SIZE, bounds.width);
  const minimumHeight = Math.min(MIN_GHOST_SIZE, bounds.height);
  let centerX = bounds.left + bounds.width / 2;
  let centerY = bounds.top + bounds.height / 2;
  let ghostWidth = bounds.width;
  let ghostHeight = bounds.height;
  let rotation = 0;
  let drag: DragState | null = null;
  let isEnded = false;

  const root = document.createElement('div');
  root.setAttribute(EDIT_OVERLAY_ATTRIBUTE, EDIT_OVERLAY_VALUE);
  root.setAttribute('style', OVERLAY_ROOT_STYLE);

  const targetLabel = describeTarget(selection.target);
  const ghost = document.createElement('div');
  ghost.setAttribute('style', GHOST_STYLE);
  ghost.setAttribute('role', 'button');
  ghost.setAttribute('tabindex', '0');
  ghost.setAttribute('aria-label', `${targetLabel}${GHOST_LABEL_SUFFIX}`);
  const ghostText = document.createElement('span');
  ghostText.setAttribute('style', GHOST_TEXT_STYLE);
  ghostText.textContent = targetLabel;
  const resizeHandle = document.createElement('span');
  resizeHandle.setAttribute('data-handle', 'resize');
  resizeHandle.setAttribute('aria-hidden', 'true');
  resizeHandle.setAttribute('style', RESIZE_HANDLE_STYLE);
  const rotateHandle = document.createElement('span');
  rotateHandle.setAttribute('data-handle', 'rotate');
  rotateHandle.setAttribute('aria-hidden', 'true');
  rotateHandle.setAttribute('style', ROTATE_HANDLE_STYLE);
  ghost.appendChild(ghostText);
  ghost.appendChild(resizeHandle);
  ghost.appendChild(rotateHandle);

  const toolbar = document.createElement('div');
  toolbar.setAttribute('style', TOOLBAR_STYLE);
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', TOOLBAR_LABEL);
  const confirmButton = document.createElement('button');
  confirmButton.setAttribute('type', 'button');
  confirmButton.setAttribute('data-action', 'confirm');
  confirmButton.setAttribute('style', CONFIRM_BUTTON_STYLE);
  confirmButton.textContent = CONFIRM_LABEL;
  const cancelButton = document.createElement('button');
  cancelButton.setAttribute('type', 'button');
  cancelButton.setAttribute('style', CANCEL_BUTTON_STYLE);
  cancelButton.textContent = CANCEL_LABEL;
  toolbar.appendChild(confirmButton);
  toolbar.appendChild(cancelButton);

  const stateStyle = document.createElement('style');
  stateStyle.textContent = STATE_STYLES;

  root.appendChild(ghost);
  root.appendChild(toolbar);
  root.appendChild(stateStyle);

  // The toolbar sits under the ghost and follows it, above it when there is no room below.
  function placeToolbar(): void {
    const toolbarWidth = toolbar.offsetWidth || 0;
    const toolbarHeight = toolbar.offsetHeight || 0;
    const box = getRotatedBox(ghostWidth, ghostHeight, rotation);
    const boxTop = centerY - box.height / 2;
    // The corner handle reaches half its size past the box, so the toolbar keeps clear of it.
    const below = boxTop + box.height + TOOLBAR_GAP + HANDLE_SIZE / 2;
    const top = below + toolbarHeight + VIEWPORT_EDGE <= viewportHeight ? below : boxTop - TOOLBAR_GAP - toolbarHeight;
    const boxLeft = centerX - box.width / 2;
    const left = Math.min(Math.max(boxLeft, VIEWPORT_EDGE), Math.max(VIEWPORT_EDGE, viewportWidth - toolbarWidth - VIEWPORT_EDGE));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${Math.max(VIEWPORT_EDGE, top)}px`;
  }

  function moveCenterTo(x: number, y: number): void {
    const box = getRotatedBox(ghostWidth, ghostHeight, rotation);
    centerX = clamp(x - box.width / 2, box.width, viewportWidth) + box.width / 2;
    centerY = clamp(y - box.height / 2, box.height, viewportHeight) + box.height / 2;
  }

  function placeGhost(): void {
    moveCenterTo(centerX, centerY);
    ghost.style.left = `${centerX - ghostWidth / 2}px`;
    ghost.style.top = `${centerY - ghostHeight / 2}px`;
    ghost.style.width = `${ghostWidth}px`;
    ghost.style.height = `${ghostHeight}px`;
    ghost.style.transform = rotation === 0 ? 'none' : `rotate(${rotation}deg)`;
    placeToolbar();
  }

  function setSize(width: number, height: number): void {
    ghostWidth = Math.min(Math.max(width, minimumWidth), bounds.width * MAX_SCALE);
    ghostHeight = Math.min(Math.max(height, minimumHeight), bounds.height * MAX_SCALE);
  }

  function scaleBy(factor: number): void {
    setSize(ghostWidth * factor, ghostHeight * factor);
  }

  function setRotation(degrees: number, snaps: boolean): void {
    const snapped = snaps ? Math.round(degrees / ROTATION_STEP) * ROTATION_STEP : degrees;
    rotation = normalizeRotation(Math.round(snapped));
  }

  // The corner under the pointer, measured along the ghost's own (rotated) axes from its centre, so the
  // ghost grows symmetrically around the centre whatever its angle.
  function resizeToward(clientX: number, clientY: number, keepsRatio: boolean): void {
    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const angle = toRadians(rotation);
    const localX = Math.abs(deltaX * Math.cos(angle) + deltaY * Math.sin(angle)) * 2;
    const localY = Math.abs(-deltaX * Math.sin(angle) + deltaY * Math.cos(angle)) * 2;
    if (!keepsRatio || bounds.width === 0 || bounds.height === 0) {
      setSize(localX, localY);
      return;
    }
    const scale = (localX / bounds.width + localY / bounds.height) / 2;
    setSize(bounds.width * scale, bounds.height * scale);
  }

  // The handle starts straight above the centre, so the pointer's angle from there is the rotation.
  function rotateToward(clientX: number, clientY: number, snaps: boolean): void {
    const degrees = (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI + 90;
    setRotation(degrees, snaps);
  }

  function handleGhostPointerDown(event: PointerEvent): void {
    blockEvent(event);
    if (event.button !== 0 || drag) {
      return;
    }
    drag = {
      kind: findHandleKind(event.target),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenterX: centerX,
      startCenterY: centerY,
    };
    ghost.setPointerCapture?.(event.pointerId);
    ghost.style.cursor = 'grabbing';
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    event.preventDefault();
    const holdsShift = event.shiftKey === true;
    switch (drag.kind) {
      case 'resize':
        resizeToward(event.clientX, event.clientY, holdsShift);
        break;
      case 'rotate':
        rotateToward(event.clientX, event.clientY, holdsShift);
        break;
      case 'move':
        centerX = drag.startCenterX + event.clientX - drag.startX;
        centerY = drag.startCenterY + event.clientY - drag.startY;
        break;
    }
    placeGhost();
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    drag = null;
    ghost.style.cursor = 'grab';
  }

  // Keep activation and field edits away from the original while preserving
  // Escape cancellation and Tab navigation to the overlay controls.
  function handleDocumentAction(event: Event): void {
    if ((event.type === 'keydown' || event.type === 'keyup') &&
      'key' in event && (event.key === 'Escape' || event.key === 'Tab')) return;
    const target = event.target;
    if (target instanceof Node && !root.contains(target) &&
      target.nodeName !== 'LATTICE-FEEDBACK-ROOT' && selection.element.contains(target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target === ghost) {
      if (event.key === 'Enter') {
        handleConfirmClick(event);
        return;
      }
      if (applyKeyboardEdit(event.key)) {
        blockEvent(event);
        placeGhost();
        return;
      }
    }
    if (event.key !== 'Escape') {
      return;
    }
    blockEvent(event);
    finish(null);
  }

  function applyKeyboardEdit(key: string): boolean {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-KEYBOARD_STEP, 0], ArrowRight: [KEYBOARD_STEP, 0], ArrowUp: [0, -KEYBOARD_STEP], ArrowDown: [0, KEYBOARD_STEP],
    };
    const direction = directions[key];
    if (direction) {
      centerX += direction[0];
      centerY += direction[1];
      return true;
    }
    switch (key) {
      case '+':
      case '=':
        scaleBy(1 + KEYBOARD_SCALE_STEP);
        return true;
      case '-':
        scaleBy(1 / (1 + KEYBOARD_SCALE_STEP));
        return true;
      case ']':
        setRotation(rotation + ROTATION_STEP, true);
        return true;
      case '[':
        setRotation(rotation - ROTATION_STEP, true);
        return true;
      default:
        return false;
    }
  }

  function handleConfirmClick(event: Event): void {
    blockEvent(event);
    const attachment: EditAttachment = {
      target: { ...selection.target, rect: originalRect },
      originalRect,
      proposedRect: {
        x: centerX - ghostWidth / 2 + scrollX,
        y: centerY - ghostHeight / 2 + scrollY,
        width: ghostWidth,
        height: ghostHeight,
      },
      viewportWidth,
      viewportHeight,
      note: '',
    };
    // An unrotated edit keeps the payload it always had.
    finish(rotation === 0 ? attachment : { ...attachment, rotation });
  }

  function handleCancelClick(event: MouseEvent): void {
    blockEvent(event);
    finish(null);
  }

  function handleViewportChange(): void {
    finish(null);
  }

  function cleanup(): void {
    ghost.removeEventListener('pointerdown', handleGhostPointerDown);
    ghost.removeEventListener('click', blockEvent);
    toolbar.removeEventListener('pointerdown', stopPropagation);
    confirmButton.removeEventListener('click', handleConfirmClick);
    cancelButton.removeEventListener('click', handleCancelClick);
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', handlePointerEnd, true);
    window.removeEventListener('pointercancel', handlePointerEnd, true);
    window.removeEventListener('resize', handleViewportChange);
    document.removeEventListener('scroll', handleViewportChange, true);
    for (const type of GUARDED_EVENTS) {
      document.removeEventListener(type, handleDocumentAction, INTERACTION_CAPTURE);
      root.removeEventListener(type, stopPropagation);
    }
    document.removeEventListener('keydown', handleKeyDown, true);
    root.remove();
  }

  function finish(attachment: EditAttachment | null): void {
    if (isEnded) {
      return;
    }
    isEnded = true;
    drag = null;
    cleanup();
    if (activeHandle === handle) {
      activeHandle = null;
    }
    if (attachment) {
      options.onComplete(attachment);
      return;
    }
    options.onCancel();
  }

  function stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  const handle: ElementDragHandle = {
    cancel: () => finish(null),
  };

  placeGhost();
  ghost.addEventListener('pointerdown', handleGhostPointerDown);
  ghost.addEventListener('click', blockEvent);
  toolbar.addEventListener('pointerdown', stopPropagation);
  confirmButton.addEventListener('click', handleConfirmClick);
  cancelButton.addEventListener('click', handleCancelClick);
  window.addEventListener('pointermove', handlePointerMove, true);
  window.addEventListener('pointerup', handlePointerEnd, true);
  window.addEventListener('pointercancel', handlePointerEnd, true);
  window.addEventListener('resize', handleViewportChange);
  document.addEventListener('scroll', handleViewportChange, true);
  for (const type of GUARDED_EVENTS) {
    document.addEventListener(type, handleDocumentAction, INTERACTION_CAPTURE);
    root.addEventListener(type, stopPropagation);
  }
  document.addEventListener('keydown', handleKeyDown, true);
  document.body.appendChild(root);
  placeToolbar();
  // Keyboard users land on the ghost right away, where the arrow keys and Enter work.
  ghost.focus?.({ preventScroll: true });

  activeHandle = handle;
  return handle;
}
