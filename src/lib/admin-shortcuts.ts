export type AdminShortcut = 'next' | 'previous' | 'accept' | 'duplicate' | 'reject';

/** What the shortcuts read from a key press. A browser KeyboardEvent fits. */
export interface ShortcutKeyEvent {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  target: object | null;
}

// Physical keys, so the shortcuts work whatever the keyboard language or input method is.
const SHORTCUT_BY_CODE: Record<string, AdminShortcut | undefined> = {
  KeyJ: 'next',
  KeyK: 'previous',
  Digit1: 'accept',
  Digit2: 'duplicate',
  Digit3: 'reject',
};
const TYPING_TAG_NAMES = ['TEXTAREA', 'SELECT'];
const NON_TYPING_INPUT_TYPES = ['radio', 'checkbox', 'button', 'submit', 'reset'];

function isTypingTarget(target: object | null): boolean {
  if (target === null || !('tagName' in target) || typeof target.tagName !== 'string') {
    return false;
  }
  if (('isContentEditable' in target && target.isContentEditable === true) || TYPING_TAG_NAMES.includes(target.tagName)) {
    return true;
  }
  const inputType = 'type' in target ? String(target.type) : '';
  return target.tagName === 'INPUT' && !NON_TYPING_INPUT_TYPES.includes(inputType);
}

/** The shortcut a key press asks for, or null while the admin is typing or holding a modifier key. */
export function findAdminShortcut(event: ShortcutKeyEvent): AdminShortcut | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || isTypingTarget(event.target)) {
    return null;
  }
  return SHORTCUT_BY_CODE[event.code] ?? null;
}

/**
 * The feedback one step below (1) or above (-1) the selected one in the visible list. With nothing selected,
 * or a selection the list no longer shows, it starts from the end the step comes from. Stops at both ends.
 */
export function findAdjacentFeedbackId(visibleIds: string[], selectedId: string | null, step: 1 | -1): string | null {
  if (visibleIds.length === 0) {
    return null;
  }
  const selectedIndex = selectedId === null ? -1 : visibleIds.indexOf(selectedId);
  if (selectedIndex === -1) {
    return step === 1 ? visibleIds[0] : visibleIds[visibleIds.length - 1];
  }
  const adjacentIndex = Math.min(Math.max(selectedIndex + step, 0), visibleIds.length - 1);
  return visibleIds[adjacentIndex];
}
