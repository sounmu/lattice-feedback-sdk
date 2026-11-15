// Comment pins and the comment editor on the live host page, rendered inside the SDK ShadowRoot so saved
// screens leave them out. They show only the reporter's own comment and a tag name or configured id.
import { MAX_COMMENT_LENGTH, truncateText } from '@/lib/feedback-limits';
import { describeTarget } from '@/lib/target-labels';
import type { CaptureTarget } from '@/sdk/capture-policy';
import type { SelectionPoint } from '@/sdk/element-selection';
import type { CommentPinSource } from '@/sdk/screen-marks';
import { PANEL_OPEN_CLASS_NAME, PHONE_MEDIA_QUERY, SDK_Z_INDEX } from '@/sdk/styles';
import {
  getStateLayer, SDK_BUTTON_BASE, SDK_FOCUS_OUTLINE, SDK_FONT, SDK_FONT_FAMILY, SDK_HOVER_MEDIA, SDK_PRESSED_SCALE, SDK_RADIUS,
  SDK_SHADOW, SDK_THEME,
} from '@/sdk/theme-tokens';

export interface CommentEditorCallbacks {
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}

export interface CommentOverlay {
  /** Replaces the pins. Call again whenever the comments change; the latest onRemove is the one used. */
  renderPins(sources: readonly CommentPinSource[], onRemove: (key: string) => void): void;
  /** Opens the editor beside the selected point. It is closed before either callback runs, so a callback may open the next one. */
  openEditor(target: CaptureTarget, point: SelectionPoint, callbacks: CommentEditorCallbacks): void;
  /** Closes the editor without calling its callbacks. */
  closeEditor(): void;
  destroy(): void;
}

interface PinMark {
  source: CommentPinSource;
  pin: HTMLButtonElement;
  remark: HTMLDivElement;
}

interface OpenEditor {
  box: HTMLDivElement;
  marker: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  target: CaptureTarget;
  point: SelectionPoint;
  callbacks: CommentEditorCallbacks;
}

// Pins keep the theme's info colour to distinguish page annotations from primary actions.
// The editor and remark are light popovers with Astryx's buttons. The
// textarea keeps 16px text: a smaller size makes iOS zoom the customer's page when it takes focus.
const COMMENT_STYLES = `
.comment-layer { display: contents; }
.comment-pin, .comment-box { position: fixed; top: 0; left: 0; box-sizing: border-box; }
.comment-pin[hidden], .comment-box[hidden] { display: none; }
.comment-pin {
  z-index: ${SDK_Z_INDEX - 1}; width: 28px; height: 28px; margin: -14px 0 0 -14px; padding: 0;
  border: 2px solid ${SDK_THEME.surface}; border-radius: ${SDK_RADIUS.full}; background: ${SDK_THEME.info}; color: ${SDK_THEME.onInfo};
  font: 700 12px/24px ${SDK_FONT_FAMILY}; text-align: center; cursor: pointer; box-shadow: ${SDK_SHADOW.medium};
}
.comment-pin::after { content: ""; position: absolute; inset: -10px; }
.comment-pin.is-pending {
  width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 3px solid ${SDK_THEME.info}; background: transparent;
  box-shadow: 0 0 0 2px ${SDK_THEME.surface}, ${SDK_SHADOW.medium}; pointer-events: none;
}
.comment-pin.is-pending::before {
  content: ""; position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px;
  border-radius: ${SDK_RADIUS.full}; background: ${SDK_THEME.info};
}
.comment-box {
  z-index: ${SDK_Z_INDEX}; width: min(300px, calc(100vw - 16px)); padding: 12px; border-radius: ${SDK_RADIUS.container};
  background: ${SDK_THEME.surface}; color: ${SDK_THEME.textPrimary}; font: ${SDK_FONT.body}; word-break: keep-all;
  box-shadow: 0 0 0 1px ${SDK_THEME.border}, ${SDK_SHADOW.high};
}
.comment-box p { max-height: 40vh; margin: 0; overflow-y: auto; overflow-wrap: anywhere; white-space: pre-wrap; }
.comment-box label { display: block; font: ${SDK_FONT.label}; color: ${SDK_THEME.textSecondary}; overflow-wrap: anywhere; }
.comment-box textarea {
  display: block; box-sizing: border-box; width: 100%; min-height: 88px; margin-top: 8px; padding: 8px 12px;
  border: 1px solid ${SDK_THEME.borderEmphasized}; border-radius: ${SDK_RADIUS.element}; resize: none;
  background: ${SDK_THEME.surface}; color: ${SDK_THEME.textPrimary}; font: 400 16px/1.4 ${SDK_FONT_FAMILY};
}
.comment-box textarea::placeholder { color: ${SDK_THEME.textSecondary}; opacity: 1; }
.comment-box textarea[aria-invalid="true"] { border-color: ${SDK_THEME.error}; }
.comment-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.comment-box button { ${SDK_BUTTON_BASE}; background-color: ${SDK_THEME.neutral}; color: ${SDK_THEME.textPrimary}; }
${SDK_HOVER_MEDIA} { .comment-box button:hover { background-image: ${getStateLayer(SDK_THEME.overlayHover)}; } }
.comment-box button:active { background-image: ${getStateLayer(SDK_THEME.overlayPressed)}; transform: ${SDK_PRESSED_SCALE}; }
.comment-box button[data-action="submit"] { background-color: ${SDK_THEME.accent}; color: ${SDK_THEME.onAccent}; }
${SDK_HOVER_MEDIA} { .comment-box button[data-action="submit"]:hover { background-image: ${getStateLayer(SDK_THEME.accentHover)}; } }
.comment-box button[data-action="submit"]:active { background-image: ${getStateLayer(SDK_THEME.overlayPressed)}; }
.comment-box button[data-action="remove"] { background-color: ${SDK_THEME.errorMuted}; color: ${SDK_THEME.onErrorMuted}; }
.comment-pin:focus-visible, .comment-box button:focus-visible {
  outline: ${SDK_FOCUS_OUTLINE.line} ${SDK_THEME.accent}; outline-offset: ${SDK_FOCUS_OUTLINE.offset};
}
.comment-pin:focus-visible { box-shadow: 0 0 0 ${SDK_FOCUS_OUTLINE.offset} ${SDK_THEME.surface}, ${SDK_SHADOW.medium}; }
.comment-box textarea:focus-visible { outline: ${SDK_FOCUS_OUTLINE.line} ${SDK_THEME.accent}; outline-offset: -1px; }
@media (prefers-reduced-motion: reduce) {
  .comment-box button { transition: none; }
  .comment-box button:active { transform: none; }
}
/* A box shares the panel's z-index and comes later, so it would paint over the panel. On a phone the open
   panel covers the page and has its own comment field, so the box stays out of the way until it closes. */
@media ${PHONE_MEDIA_QUERY} {
  .panel.${PANEL_OPEN_CLASS_NAME} ~ .comment-layer .comment-box { visibility: hidden; }
}
`;

const EDITOR_LABEL = '코멘트 입력';
const PIN_LABEL = '코멘트';
const PLACEHOLDER = '이 자리에 남길 의견을 적어 주세요';
const SUBMIT_LABEL = '코멘트 첨부';
const CANCEL_LABEL = '취소';
const REMOVE_LABEL = '삭제';
const GAP = 16;
const EDGE = 8;
const SCROLL_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;
// While the editor is open the host page must not react to a stray click (a button firing or a link
// navigating would lose the draft). Scrolling is left alone, so touchstart/touchmove are not guarded.
const GUARDED_HOST_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'] as const;
const GUARD_OPTIONS: AddEventListenerOptions = { capture: true, passive: false };
const SDK_ELEMENTS = 'lattice-feedback-root, [data-lattice-overlay]';

function isSdkTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SDK_ELEMENTS) !== null;
}

function createButton(action: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-action', action);
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createActions(...buttons: HTMLButtonElement[]): HTMLDivElement {
  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  actions.append(...buttons);
  return actions;
}

// A point scrolled out of a scrolling or clipping ancestor is not on screen even while inside the viewport.
function isClipped(element: Element, x: number, y: number): boolean {
  for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const box = ancestor.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return true;
  }
  return false;
}

function findPoint(element: Element, offset: SelectionPoint): { x: number; y: number; visible: boolean } {
  const bounds = element.getBoundingClientRect();
  const x = bounds.left + bounds.width * offset.x;
  const y = bounds.top + bounds.height * offset.y;
  const visible = element.isConnected && bounds.width > 0 && bounds.height > 0 &&
    x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight && !isClipped(element, x, y);
  return { x, y, visible };
}

// After the anchor when the box fits there, before it otherwise, and always inside the viewport.
function fit(anchor: number, size: number, limit: number): number {
  const after = anchor + GAP;
  const position = after + size + EDGE <= limit ? after : anchor - GAP - size;
  return Math.max(EDGE, Math.min(position, limit - size - EDGE));
}

function placeBeside(box: HTMLElement, x: number, y: number): void {
  box.style.transform = `translate(${fit(x, box.offsetWidth, window.innerWidth)}px, ${fit(y, box.offsetHeight, window.innerHeight)}px)`;
}

export function createCommentOverlay(root: ShadowRoot): CommentOverlay {
  const styleElement = document.createElement('style');
  styleElement.textContent = COMMENT_STYLES;
  const layer = document.createElement('div');
  layer.className = 'comment-layer';
  const pinList = document.createElement('div');
  pinList.className = 'comment-layer';
  layer.append(pinList);
  root.append(styleElement, layer);
  let marks: PinMark[] = [];
  let removePin: (key: string) => void = () => undefined;
  let openKey: string | null = null;
  let editor: OpenEditor | null = null;
  let isListening = false;
  let isGuarding = false;
  let isDestroyed = false;

  function refresh(): void {
    for (const { source, pin, remark } of marks) {
      const { x, y, visible } = findPoint(source.element, source.offset);
      const isOpen = visible && openKey === source.key;
      pin.hidden = !visible;
      remark.hidden = !isOpen;
      pin.setAttribute('aria-expanded', String(isOpen));
      if (!visible) continue;
      pin.style.transform = `translate(${x}px, ${y}px)`;
      if (isOpen) placeBeside(remark, x, y);
    }
    // An element removed while its comment is being written leaves the editor where it was.
    if (editor && editor.target.element.isConnected) {
      const { x, y, visible } = findPoint(editor.target.element, editor.point);
      editor.marker.hidden = !visible;
      editor.marker.style.transform = `translate(${x}px, ${y}px)`;
      placeBeside(editor.box, x, y);
    }
  }

  // An outside click never reaches the host. With nothing typed it closes the editor so the next click
  // picks again; with a draft it only brings the reporter back to the text they were writing.
  function handleHostPointer(event: Event): void {
    if (!editor || isSdkTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    if (editor.textarea.value.trim().length === 0) {
      cancelEditor();
      return;
    }
    editor.textarea.focus();
  }

  // The host page is listened to only while there is something to keep in place or to protect.
  function syncListeners(): void {
    const isNeeded = !isDestroyed && (marks.length > 0 || editor !== null);
    if (isNeeded !== isListening) {
      isListening = isNeeded;
      if (isNeeded) {
        window.addEventListener('scroll', refresh, SCROLL_OPTIONS);
        window.addEventListener('resize', refresh);
      } else {
        window.removeEventListener('scroll', refresh, SCROLL_OPTIONS);
        window.removeEventListener('resize', refresh);
      }
    }
    const isGuardNeeded = !isDestroyed && editor !== null;
    if (isGuardNeeded === isGuarding) return;
    isGuarding = isGuardNeeded;
    for (const type of GUARDED_HOST_EVENTS) {
      if (isGuardNeeded) window.addEventListener(type, handleHostPointer, GUARD_OPTIONS);
      else window.removeEventListener(type, handleHostPointer, GUARD_OPTIONS);
    }
  }

  function isSamePins(sources: readonly CommentPinSource[]): boolean {
    return sources.length === marks.length && sources.every((source, index) => {
      const current = marks[index].source;
      return source.key === current.key && source.number === current.number && source.comment === current.comment &&
        source.label === current.label && source.element === current.element &&
        source.offset.x === current.offset.x && source.offset.y === current.offset.y;
    });
  }

  function createMark(source: CommentPinSource): PinMark {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'comment-pin';
    pin.textContent = String(source.number);
    pin.setAttribute('aria-label', `${PIN_LABEL} ${source.number}: ${source.label}`);
    pin.addEventListener('click', () => {
      openKey = openKey === source.key ? null : source.key;
      refresh();
    });
    const remark = document.createElement('div');
    remark.className = 'comment-box';
    remark.setAttribute('role', 'group');
    remark.setAttribute('aria-label', `${PIN_LABEL} ${source.number}`);
    const text = document.createElement('p');
    text.textContent = source.comment;
    remark.append(text, createActions(createButton('remove', REMOVE_LABEL, () => removePin(source.key))));
    return { source, pin, remark };
  }

  function renderPins(sources: readonly CommentPinSource[], onRemove: (key: string) => void): void {
    if (isDestroyed) return;
    removePin = onRemove;
    // Unchanged pins are kept, so keyboard focus and an open remark survive unrelated updates.
    if (!isSamePins(sources)) {
      marks = sources.map(createMark);
      pinList.replaceChildren(...marks.flatMap(({ pin, remark }) => [pin, remark]));
      if (!marks.some(({ source }) => source.key === openKey)) openKey = null;
    }
    syncListeners();
    refresh();
  }

  function closeEditor(): void {
    openKey = null;
    refresh();
    if (!editor) return;
    editor.box.remove();
    editor.marker.remove();
    editor = null;
    syncListeners();
  }

  function submitEditor(): void {
    if (!editor) return;
    const comment = truncateText(editor.textarea.value.trim(), MAX_COMMENT_LENGTH);
    if (!comment) {
      editor.textarea.setAttribute('aria-invalid', 'true');
      editor.textarea.focus();
      return;
    }
    const { callbacks } = editor;
    closeEditor();
    callbacks.onSubmit(comment);
  }

  function cancelEditor(): void {
    if (!editor) return;
    const { callbacks } = editor;
    closeEditor();
    callbacks.onCancel();
  }

  function openEditor(target: CaptureTarget, point: SelectionPoint, callbacks: CommentEditorCallbacks): void {
    if (isDestroyed) return;
    closeEditor();
    openKey = null;
    const box = document.createElement('div');
    box.className = 'comment-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', EDITOR_LABEL);
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = `${EDITOR_LABEL} · ${describeTarget(target.target)}`;
    const textarea = document.createElement('textarea');
    textarea.maxLength = MAX_COMMENT_LENGTH;
    textarea.placeholder = PLACEHOLDER;
    label.append(caption, textarea);
    box.append(label, createActions(
      createButton('cancel', CANCEL_LABEL, cancelEditor),
      createButton('submit', SUBMIT_LABEL, submitEditor),
    ));
    const marker = document.createElement('div');
    marker.className = 'comment-pin is-pending';
    marker.setAttribute('aria-hidden', 'true');
    layer.append(marker, box);
    editor = { box, marker, textarea, target, point, callbacks };
    syncListeners();
    refresh();
    textarea.focus();
  }

  function handleKey(event: KeyboardEvent): void {
    // Keys typed in the SDK's own controls must not reach the host page's shortcut handlers.
    event.stopPropagation();
    // Escape and Enter that only finish an IME composition (Korean input) are left to the IME.
    if (event.type !== 'keydown' || event.isComposing) return;
    if (event.key === 'Escape' && editor) {
      event.preventDefault();
      cancelEditor();
    } else if (event.key === 'Escape' && openKey !== null) {
      event.preventDefault();
      openKey = null;
      refresh();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && editor) {
      event.preventDefault();
      submitEditor();
    }
  }

  function destroy(): void {
    if (isDestroyed) return;
    closeEditor();
    isDestroyed = true;
    marks = [];
    syncListeners();
    for (const type of KEY_EVENTS) {
      layer.removeEventListener(type, handleKey);
    }
    layer.remove();
    styleElement.remove();
  }

  for (const type of KEY_EVENTS) {
    layer.addEventListener(type, handleKey);
  }

  return { renderPins, openEditor, closeEditor, destroy };
}
