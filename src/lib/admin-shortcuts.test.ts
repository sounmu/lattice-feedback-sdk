import { describe, expect, it } from 'vitest';

import { findAdjacentFeedbackId, findAdminShortcut, type ShortcutKeyEvent } from '@/lib/admin-shortcuts';

function createKeyEvent(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { code: 'KeyJ', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, target: { tagName: 'BODY' }, ...overrides };
}

describe('findAdminShortcut', () => {
  it('reads the physical key, so a Korean input method does not change the shortcut', () => {
    const codes = ['KeyJ', 'KeyK', 'Digit1', 'Digit2', 'Digit3', 'KeyQ'];

    expect(codes.map((code) => findAdminShortcut(createKeyEvent({ code })))).toEqual(['next', 'previous', 'accept', 'duplicate', 'reject', null]);
  });

  it('stays out of the way of browser shortcuts and text being composed', () => {
    const held: Partial<ShortcutKeyEvent>[] = [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }];

    expect(held.map((overrides) => findAdminShortcut(createKeyEvent(overrides)))).toEqual([null, null, null, null, null]);
  });

  it('does nothing while the admin types, but works on a focused radio button or link', () => {
    const typingTargets = [
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'INPUT', type: 'search' },
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'DIV', isContentEditable: true },
    ];
    const otherTargets = [{ tagName: 'INPUT', type: 'radio' }, { tagName: 'A' }, { tagName: 'BUTTON', type: 'button' }, null];

    expect(typingTargets.map((target) => findAdminShortcut(createKeyEvent({ target })))).toEqual([null, null, null, null, null]);
    expect(otherTargets.map((target) => findAdminShortcut(createKeyEvent({ target })))).toEqual(['next', 'next', 'next', 'next']);
  });
});

describe('findAdjacentFeedbackId', () => {
  const ids = ['a', 'b', 'c'];

  it('moves one step and stops at both ends', () => {
    expect(findAdjacentFeedbackId(ids, 'a', 1)).toBe('b');
    expect(findAdjacentFeedbackId(ids, 'b', -1)).toBe('a');
    expect(findAdjacentFeedbackId(ids, 'c', 1)).toBe('c');
    expect(findAdjacentFeedbackId(ids, 'a', -1)).toBe('a');
  });

  it('starts from the top going down and from the bottom going up when the selection is not in the list', () => {
    expect(findAdjacentFeedbackId(ids, null, 1)).toBe('a');
    expect(findAdjacentFeedbackId(ids, null, -1)).toBe('c');
    expect(findAdjacentFeedbackId(ids, 'filtered-out', 1)).toBe('a');
    expect(findAdjacentFeedbackId([], 'a', 1)).toBeNull();
  });
});
