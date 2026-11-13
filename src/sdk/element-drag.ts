// Edit mode engine (AGENTS.md section 3, Edit): the user drags an isolated ghost
// that stands in for the selected element. The original element, its styles, and
// any framework state are never written to; only the ghost overlay moves.
//
// Data minimization (AGENTS.md section 5): the ghost is a neutral replica built
// from the element's bounds and the policy-configured id. No host text, HTML,
// attributes, or input values are copied into the overlay or the payload.
//
// Viewport freeze: the ghost is position: fixed and coordinates are converted to
// document CSS px once at start. Any resize or scroll (including nested
// scrollers, observed in the capture phase) would invalidate that mapping, so it
// cancels the active edit instead of trying to re-project positions.
import type { CaptureTarget } from '@/sdk/capture-policy';
import { SDK_Z_INDEX } from '@/sdk/styles';
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
const GUARDED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'beforeinput', 'keydown', 'keyup'] as const;
const INTERACTION_CAPTURE: AddEventListenerOptions = { capture: true, passive: false };

const OVERLAY_ROOT_STYLE = `position: fixed; inset: 0; z-index: ${SDK_Z_INDEX}; pointer-events: none; margin: 0; padding: 0;`;
const GHOST_STYLE = [
  'position: fixed',
  'box-sizing: border-box',
  'margin: 0',
  'padding: 4px',
  'border: 2px dashed #2563eb',
  'border-radius: 4px',
  'background: rgba(37, 99, 235, 0.18)',
  'color: #1e3a8a',
  'font: 600 12px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  'overflow: hidden',
  'cursor: grab',
  'user-select: none',
  'touch-action: none',
  'pointer-events: auto',
].join('; ');
const TOOLBAR_STYLE = [
  'position: fixed',
  'left: 50%',
  'bottom: 24px',
  'transform: translateX(-50%)',
  'display: flex',
  'gap: 8px',
  'padding: 8px',
  'border-radius: 8px',
  'background: #111827',
  'box-shadow: 0 6px 20px rgba(17, 24, 39, 0.3)',
  'pointer-events: auto',
].join('; ');
const BUTTON_STYLE = [
  'all: initial',
  'padding: 8px 14px',
  'border-radius: 6px',
  'font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  'cursor: pointer',
].join('; ');
const CONFIRM_BUTTON_STYLE = `${BUTTON_STYLE}; background: #2563eb; color: #ffffff;`;
const CANCEL_BUTTON_STYLE = `${BUTTON_STYLE}; background: #374151; color: #f9fafb;`;

let activeHandle: ElementDragHandle | null = null;

function clamp(value: number, size: number, viewportSize: number): number {
  // Keep the ghost fully on screen when it fits; otherwise keep it covering the viewport.
  const limit = viewportSize - size;
  return Math.min(Math.max(value, Math.min(0, limit)), Math.max(0, limit));
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
  let ghostLeft = bounds.left;
  let ghostTop = bounds.top;
  let drag: { pointerId: number; startX: number; startY: number; startLeft: number; startTop: number } | null = null;
  let isEnded = false;

  const root = document.createElement('div');
  root.setAttribute(EDIT_OVERLAY_ATTRIBUTE, EDIT_OVERLAY_VALUE);
  root.setAttribute('style', OVERLAY_ROOT_STYLE);

  const ghost = document.createElement('div');
  ghost.setAttribute('style', GHOST_STYLE);
  ghost.setAttribute('role', 'button');
  ghost.setAttribute('tabindex', '0');
  ghost.setAttribute('aria-label', '이동 미리보기: 방향키로 이동, Enter로 첨부');
  ghost.textContent = selection.target.feedbackId ?? selection.target.tagName;
  ghost.style.width = `${bounds.width}px`;
  ghost.style.height = `${bounds.height}px`;

  const toolbar = document.createElement('div');
  toolbar.setAttribute('style', TOOLBAR_STYLE);
  const confirmButton = document.createElement('button');
  confirmButton.setAttribute('type', 'button');
  confirmButton.setAttribute('style', CONFIRM_BUTTON_STYLE);
  confirmButton.textContent = CONFIRM_LABEL;
  const cancelButton = document.createElement('button');
  cancelButton.setAttribute('type', 'button');
  cancelButton.setAttribute('style', CANCEL_BUTTON_STYLE);
  cancelButton.textContent = CANCEL_LABEL;
  toolbar.appendChild(confirmButton);
  toolbar.appendChild(cancelButton);

  root.appendChild(ghost);
  root.appendChild(toolbar);

  function placeGhost(): void {
    ghost.style.left = `${ghostLeft}px`;
    ghost.style.top = `${ghostTop}px`;
  }

  function handleGhostPointerDown(event: PointerEvent): void {
    blockEvent(event);
    if (event.button !== 0 || drag) {
      return;
    }
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startLeft: ghostLeft, startTop: ghostTop };
    ghost.setPointerCapture?.(event.pointerId);
    ghost.style.cursor = 'grabbing';
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    event.preventDefault();
    ghostLeft = clamp(drag.startLeft + event.clientX - drag.startX, bounds.width, viewportWidth);
    ghostTop = clamp(drag.startTop + event.clientY - drag.startY, bounds.height, viewportHeight);
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
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8],
      };
      const direction = directions[event.key];
      if (direction) {
        blockEvent(event);
        ghostLeft = clamp(ghostLeft + direction[0], bounds.width, viewportWidth);
        ghostTop = clamp(ghostTop + direction[1], bounds.height, viewportHeight);
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

  function handleConfirmClick(event: Event): void {
    blockEvent(event);
    finish({
      target: { ...selection.target, rect: originalRect },
      originalRect,
      proposedRect: { x: ghostLeft + scrollX, y: ghostTop + scrollY, width: bounds.width, height: bounds.height },
      viewportWidth,
      viewportHeight,
      note: '',
    });
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

  activeHandle = handle;
  return handle;
}
