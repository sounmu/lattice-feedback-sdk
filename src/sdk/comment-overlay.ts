// Comment pins and the comment editor on the live host page, rendered inside the SDK ShadowRoot so saved
// screens leave them out. They show only the reporter's own comment and a tag name or configured id.
import { MAX_COMMENT_LENGTH, truncateText } from '@/lib/feedback-limits';
import type { CaptureTarget } from '@/sdk/capture-policy';
import type { SelectionPoint } from '@/sdk/element-selection';
import type { CommentPinSource } from '@/sdk/screen-marks';
import { SDK_Z_INDEX } from '@/sdk/styles';

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

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const COMMENT_STYLES = `
.comment-layer { display: contents; }
.comment-pin, .comment-box { position: fixed; top: 0; left: 0; box-sizing: border-box; }
.comment-pin[hidden], .comment-box[hidden] { display: none; }
.comment-pin {
  z-index: ${SDK_Z_INDEX - 1}; width: 28px; height: 28px; margin: -14px 0 0 -14px; padding: 0;
  border: 2px solid #ffffff; border-radius: 50%; background: #2563eb; color: #ffffff;
  font: 700 13px/24px ${FONT}; text-align: center; cursor: pointer; box-shadow: 0 2px 8px rgba(17, 24, 39, 0.35);
}
.comment-pin::after { content: ""; position: absolute; inset: -10px; }
.comment-pin.is-pending { background: #111827; pointer-events: none; }
.comment-box {
  z-index: ${SDK_Z_INDEX}; width: min(300px, calc(100vw - 16px)); padding: 12px; border-radius: 12px;
  background: #ffffff; color: #111827; font: 400 14px/1.5 ${FONT}; box-shadow: 0 12px 40px rgba(17, 24, 39, 0.3);
}
.comment-box p { max-height: 40vh; margin: 0; overflow-y: auto; overflow-wrap: anywhere; white-space: pre-wrap; }
.comment-box label { display: block; font-weight: 600; overflow-wrap: anywhere; }
.comment-box textarea {
  display: block; box-sizing: border-box; width: 100%; min-height: 88px; margin-top: 6px; padding: 8px;
  border: 1px solid #6b7280; border-radius: 8px; resize: none; background: #ffffff; color: #111827;
  font: 400 16px/1.4 ${FONT};
}
.comment-box textarea[aria-invalid="true"] { border-color: #dc2626; }
.comment-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.comment-box button {
  min-width: 44px; min-height: 44px; padding: 0 14px; border: 0; border-radius: 8px;
  background: #e5e7eb; color: #111827; font: 600 14px/1 ${FONT}; cursor: pointer;
}
.comment-box button[data-action="submit"] { background: #2563eb; color: #ffffff; }
.comment-box button[data-action="remove"] { background: #b91c1c; color: #ffffff; }
.comment-pin:focus-visible, .comment-box button:focus-visible, .comment-box textarea:focus-visible {
  outline: 2px solid #60a5fa; outline-offset: 2px;
}
`;

const EDITOR_LABEL = 'Comment 입력';
const PLACEHOLDER = '이 위치에 남길 의견을 입력하세요';
const SUBMIT_LABEL = '첨부';
const CANCEL_LABEL = '취소';
const REMOVE_LABEL = '삭제';
const GAP = 16;
const EDGE = 8;
const SCROLL_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;

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

  // The host page is listened to only while there is something to keep in place.
  function syncListeners(): void {
    const isNeeded = !isDestroyed && (marks.length > 0 || editor !== null);
    if (isNeeded === isListening) return;
    isListening = isNeeded;
    if (isNeeded) {
      window.addEventListener('scroll', refresh, SCROLL_OPTIONS);
      window.addEventListener('resize', refresh);
    } else {
      window.removeEventListener('scroll', refresh, SCROLL_OPTIONS);
      window.removeEventListener('resize', refresh);
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
    pin.setAttribute('aria-label', `Comment ${source.number}: ${source.label}`);
    pin.addEventListener('click', () => {
      openKey = openKey === source.key ? null : source.key;
      refresh();
    });
    const remark = document.createElement('div');
    remark.className = 'comment-box';
    remark.setAttribute('role', 'group');
    remark.setAttribute('aria-label', `Comment ${source.number}`);
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
    caption.textContent = `${EDITOR_LABEL} · ${target.target.feedbackId ?? target.target.tagName}`;
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
    marker.textContent = '+';
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
