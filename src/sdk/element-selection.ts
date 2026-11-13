import type { CaptureTarget } from '@/sdk/capture-policy';
import { SDK_Z_INDEX } from '@/sdk/styles';

export interface ElementSelectionOptions {
  readonly findTarget: (target: EventTarget | null) => CaptureTarget | null;
  /** point is where the element was clicked, as fractions of its width and height. */
  readonly onSelect: (selection: CaptureTarget, point: SelectionPoint) => void;
  readonly onCancel: () => void;
}

export interface SelectionPoint {
  x: number;
  y: number;
}

function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0.5;
}

function findSelectionPoint(element: HTMLElement, event: Event): SelectionPoint {
  const bounds = element.getBoundingClientRect();
  const source = 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : (event as MouseEvent);
  if (!source || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0.5, y: 0.5 };
  }
  return {
    x: clampFraction((source.clientX - bounds.left) / bounds.width),
    y: clampFraction((source.clientY - bounds.top) / bounds.height),
  };
}

export interface ElementSelection {
  cancel(): void;
}

const SDK_ELEMENTS = 'lattice-feedback-root, [data-lattice-overlay]';
// Host handlers may react to any of these, so all of them are swallowed while selecting.
const GUARDED_POINTER_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend'] as const;
const GUARDED_KEY_EVENTS = ['keydown', 'keyup'] as const;
const ACTIVATION_KEYS = new Set(['Enter', ' ', 'Spacebar']);
const CAPTURE: AddEventListenerOptions = { capture: true, passive: false };
const PASSIVE_CAPTURE: AddEventListenerOptions = { capture: true, passive: true };
const OVERLAY_STYLE = [
  'position: fixed',
  'top: 0',
  'left: 0',
  'display: none',
  'box-sizing: border-box',
  'pointer-events: none',
  `z-index: ${SDK_Z_INDEX - 1}`,
  'border: 2px solid #2563eb',
  'border-radius: 4px',
  'background: rgba(37, 99, 235, 0.12)',
].join('; ');

function isSdkTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SDK_ELEMENTS) !== null;
}

export function startElementSelection(options: ElementSelectionOptions): ElementSelection {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-lattice-overlay', 'selection');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = OVERLAY_STYLE;
  let highlightedElement: HTMLElement | null = null;
  let isActive = true;

  const hideOutline = (): void => {
    highlightedElement = null;
    overlay.style.display = 'none';
  };

  const refreshOutline = (): void => {
    if (!highlightedElement || !highlightedElement.isConnected) {
      hideOutline();
      return;
    }
    const bounds = highlightedElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      hideOutline();
      return;
    }
    overlay.style.transform = `translate(${bounds.left}px, ${bounds.top}px)`;
    overlay.style.width = `${bounds.width}px`;
    overlay.style.height = `${bounds.height}px`;
    overlay.style.display = 'block';
  };

  const highlight = (target: EventTarget | null): void => {
    const selection = isSdkTarget(target) ? null : options.findTarget(target);
    highlightedElement = selection ? selection.element : null;
    refreshOutline();
  };

  const handlePointerOver = (event: Event): void => highlight(event.target);

  const handlePointer = (event: Event): void => {
    if (isSdkTarget(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'pointerdown' || event.type === 'touchstart') {
      // Touch has no hover, so show the outline as soon as the finger lands.
      highlight(event.target);
      return;
    }
    if (event.type !== 'click' && event.type !== 'touchend') {
      return;
    }
    const selection = options.findTarget(event.target);
    if (!selection) {
      return;
    }
    const point = findSelectionPoint(selection.element, event);
    cleanup();
    options.onSelect(selection, point);
  };

  const handleKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keydown') {
        cleanup();
        options.onCancel();
      }
      return;
    }
    if (ACTIVATION_KEYS.has(event.key) && !isSdkTarget(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  function cleanup(): void {
    if (!isActive) {
      return;
    }
    isActive = false;
    for (const type of GUARDED_POINTER_EVENTS) {
      window.removeEventListener(type, handlePointer, CAPTURE);
    }
    for (const type of GUARDED_KEY_EVENTS) {
      window.removeEventListener(type, handleKey, CAPTURE);
    }
    window.removeEventListener('pointerover', handlePointerOver, CAPTURE);
    window.removeEventListener('scroll', refreshOutline, PASSIVE_CAPTURE);
    window.removeEventListener('resize', refreshOutline);
    highlightedElement = null;
    overlay.remove();
  }

  for (const type of GUARDED_POINTER_EVENTS) {
    window.addEventListener(type, handlePointer, CAPTURE);
  }
  for (const type of GUARDED_KEY_EVENTS) {
    window.addEventListener(type, handleKey, CAPTURE);
  }
  window.addEventListener('pointerover', handlePointerOver, CAPTURE);
  window.addEventListener('scroll', refreshOutline, PASSIVE_CAPTURE);
  window.addEventListener('resize', refreshOutline);
  (document.body ?? document.documentElement).appendChild(overlay);

  return { cancel: cleanup };
}
