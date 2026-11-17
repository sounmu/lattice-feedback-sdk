import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureTarget } from '@/sdk/capture-policy';
import { startElementDrag } from '@/sdk/element-drag';
import type { EditAttachment } from '@/types/feedback';

import { FakeElement, FakeEventTarget, createEvent } from '@/sdk/element-drag-test-fixtures';

let fakeWindow: FakeEventTarget & { scrollX: number; scrollY: number; innerWidth: number; innerHeight: number };
let fakeDocument: FakeEventTarget & { body: FakeElement; createElement: (tagName: string) => FakeElement };
let hostElement: FakeElement;
let selection: CaptureTarget;

function getOverlay() {
  const root = fakeDocument.body.children[0];
  const [ghost, toolbar] = root.children;
  const [undoButton, redoButton, resetButton, confirmButton, cancelButton] = toolbar.children;
  return { root, ghost, toolbar, undoButton, redoButton, resetButton, confirmButton, cancelButton };
}

function expectCleanedUp(): void {
  expect(fakeDocument.body.children).toHaveLength(0);
  expect(fakeWindow.listenerCount).toBe(0);
  expect(fakeDocument.listenerCount).toBe(0);
}

beforeEach(() => {
  fakeWindow = Object.assign(new FakeEventTarget(), { scrollX: 0, scrollY: 100, innerWidth: 1000, innerHeight: 800 });
  fakeDocument = Object.assign(new FakeEventTarget(), {
    body: new FakeElement('body'),
    createElement: (tagName: string) => tagName === 'host-button' ? hostElement : new FakeElement(tagName),
  });
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('Node', FakeElement);

  hostElement = new FakeElement('BUTTON');
  hostElement.bounds = { left: 100, top: 50, width: 120, height: 40 };
  hostElement.textContent = 'Customer Kim contract 2026-001';
  hostElement.setAttribute('value', 'secret-input-value');
  selection = {
    element: document.createElement('host-button'),
    target: {
      selector: 'main .save',
      feedbackId: 'save-button',
      tagName: 'button',
      rect: { x: 0, y: 0, width: 1, height: 1 },
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

describe('startElementDrag', () => {
  it('renders an isolated neutral ghost at the target bounds without touching the original', () => {
    const handle = startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const { root, ghost, toolbar, confirmButton, cancelButton } = getOverlay();

    expect(root.getAttribute('data-lattice-overlay')).toBe('edit');
    expect(ghost.style).toMatchObject({ left: '100px', top: '50px', width: '120px', height: '40px' });
    expect(ghost.getAttribute('style')).toContain('touch-action: none');
    expect(root.getAttribute('style')).not.toContain('touch-action');
    expect(toolbar.getAttribute('style')).not.toContain('touch-action');
    expect([confirmButton.textContent, cancelButton.textContent]).toEqual(['변경 첨부', '취소']);
    expect(root.allText).not.toContain('Kim');
    expect(root.allText).not.toContain('secret');
    expect(hostElement.style).toEqual({});
    expect([...hostElement.attributes.entries()]).toEqual([['value', 'secret-input-value']]);
    expect(hostElement.listenerCount).toBe(0);

    handle.cancel();
  });

  it('drags the ghost and emits document-coordinate rects only after cleanup', () => {
    const onCancel = vi.fn();
    let attachment: EditAttachment | null = null;
    const onComplete = vi.fn((value: EditAttachment) => {
      expectCleanedUp();
      attachment = value;
    });
    startElementDrag(selection, { onComplete, onCancel });
    const { ghost, confirmButton } = getOverlay();

    const pointerDown = createEvent('pointerdown', { target: ghost, clientX: 110, clientY: 60 });
    ghost.dispatch(pointerDown);
    fakeWindow.dispatch(createEvent('pointermove', { pointerId: 2, clientX: 900, clientY: 700 }));
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 160, clientY: 260 }));
    fakeWindow.dispatch(createEvent('pointerup', { clientX: 160, clientY: 260 }));
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 500, clientY: 500 }));

    expect(pointerDown.preventDefault).toHaveBeenCalled();
    expect(pointerDown.stopPropagation).toHaveBeenCalled();
    expect(ghost.setPointerCapture).toHaveBeenCalledWith(1);
    expect(ghost.style).toMatchObject({ left: '150px', top: '250px' });

    confirmButton.dispatch(createEvent('click', { target: confirmButton }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(attachment).toEqual({
      target: { selector: 'main .save', feedbackId: 'save-button', tagName: 'button', rect: { x: 100, y: 150, width: 120, height: 40 } },
      originalRect: { x: 100, y: 150, width: 120, height: 40 },
      proposedRect: { x: 150, y: 350, width: 120, height: 40 },
      viewportWidth: 1000,
      viewportHeight: 800,
      note: '',
    });
  });

  it('scales the ghost around its centre from the corner handle, keeping the ratio while Shift is held', () => {
    let attachment: EditAttachment | null = null;
    startElementDrag(selection, { onComplete: (value) => { attachment = value; }, onCancel: vi.fn() });
    const { ghost, confirmButton } = getOverlay();
    const resizeHandle = ghost.children[1];

    ghost.dispatch(createEvent('pointerdown', { target: resizeHandle, clientX: 220, clientY: 90 }));
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 190, clientY: 100, shiftKey: true }));
    expect(ghost.style).toMatchObject({ width: '120px', height: '40px' });
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 250, clientY: 100 }));
    fakeWindow.dispatch(createEvent('pointerup', { clientX: 250, clientY: 100 }));

    expect(resizeHandle.getAttribute('data-handle')).toBe('resize');
    expect(ghost.style).toMatchObject({ left: '70px', top: '40px', width: '180px', height: '60px', transform: 'none' });
    confirmButton.dispatch(createEvent('click', { target: confirmButton }));
    expect(attachment).toMatchObject({ proposedRect: { x: 70, y: 140, width: 180, height: 60 } });
    expect(attachment).not.toHaveProperty('rotation');
  });

  it('turns the ghost from the handle above it, in 15 degree steps while Shift is held', () => {
    let attachment: EditAttachment | null = null;
    startElementDrag(selection, { onComplete: (value) => { attachment = value; }, onCancel: vi.fn() });
    const { ghost, confirmButton } = getOverlay();
    const rotateHandle = ghost.children[2];

    ghost.dispatch(createEvent('pointerdown', { target: rotateHandle, clientX: 160, clientY: 22 }));
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 260, clientY: 75 }));
    expect(ghost.style.transform).toBe('rotate(93deg)');
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 260, clientY: 75, shiftKey: true }));
    fakeWindow.dispatch(createEvent('pointerup', { clientX: 260, clientY: 75 }));

    expect(ghost.style).toMatchObject({ left: '100px', top: '50px', width: '120px', height: '40px', transform: 'rotate(90deg)' });
    confirmButton.dispatch(createEvent('click', { target: confirmButton }));
    expect(attachment).toMatchObject({ proposedRect: { x: 100, y: 150, width: 120, height: 40 }, rotation: 90 });
  });

  it('scales and turns the ghost from the keyboard and attaches it with Enter', () => {
    const onComplete = vi.fn<(value: EditAttachment) => void>();
    startElementDrag(selection, { onComplete, onCancel: vi.fn() });
    const { ghost } = getOverlay();

    for (const key of ['+', '[', '[']) {
      const event = createEvent('keydown', { target: ghost, key });
      fakeDocument.dispatch(event);
      expect(event.preventDefault).toHaveBeenCalled();
    }
    expect(ghost.style.transform).toBe('rotate(-30deg)');
    fakeDocument.dispatch(createEvent('keydown', { target: ghost, key: 'Enter' }));

    const [attachment] = onComplete.mock.calls[0];
    expect(attachment.rotation).toBe(-30);
    expect(attachment.proposedRect.width).toBeCloseTo(132);
    expect(attachment.proposedRect.height).toBeCloseTo(44);
  });

  it('undoes, redoes and resets the steps of one edit, and leaves out steps that changed nothing', () => {
    const onComplete = vi.fn<(value: EditAttachment) => void>();
    startElementDrag(selection, { onComplete, onCancel: vi.fn() });
    const { ghost, undoButton, redoButton, resetButton, confirmButton } = getOverlay();
    const press = (key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) =>
      fakeDocument.dispatch(createEvent('keydown', { target: ghost, key, ...modifiers }));
    const click = (button: typeof undoButton) => button.dispatch(createEvent('click', { target: button }));

    expect([undoButton.textContent, redoButton.textContent, resetButton.textContent]).toEqual(['되돌리기', '다시 하기', '원래대로']);
    expect([undoButton.disabled, redoButton.disabled, resetButton.disabled]).toEqual([true, true, true]);

    ghost.dispatch(createEvent('pointerdown', { target: ghost, clientX: 110, clientY: 60 }));
    fakeWindow.dispatch(createEvent('pointerup', { clientX: 110, clientY: 60 }));
    expect(undoButton.disabled).toBe(true);

    press(']');
    press('ArrowRight');
    expect(ghost.style).toMatchObject({ left: '108px', transform: 'rotate(15deg)' });
    click(undoButton);
    expect(ghost.style).toMatchObject({ left: '100px', transform: 'rotate(15deg)' });
    press('z', { ctrlKey: true });
    expect(ghost.style).toMatchObject({ left: '100px', transform: 'none' });
    expect([undoButton.disabled, redoButton.disabled, resetButton.disabled]).toEqual([true, false, true]);
    press('z', { ctrlKey: true, shiftKey: true });
    click(redoButton);
    expect(ghost.style).toMatchObject({ left: '108px', transform: 'rotate(15deg)' });

    click(resetButton);
    expect(ghost.style).toMatchObject({ left: '100px', top: '50px', width: '120px', height: '40px', transform: 'none' });
    expect([undoButton.disabled, resetButton.disabled]).toEqual([false, true]);
    click(undoButton);
    expect(ghost.style).toMatchObject({ left: '108px', transform: 'rotate(15deg)' });

    click(confirmButton);
    expect(onComplete.mock.calls[0][0]).toMatchObject({ proposedRect: { x: 108, y: 150 }, rotation: 15 });
  });

  it('starts and resets at the real position of an element partly scrolled out of view', () => {
    hostElement.bounds = { left: 940, top: 50, width: 120, height: 40 };
    const onComplete = vi.fn<(value: EditAttachment) => void>();
    startElementDrag(selection, { onComplete, onCancel: vi.fn() });
    const { ghost, resetButton, confirmButton } = getOverlay();

    expect(ghost.style).toMatchObject({ left: '940px', top: '50px' });
    fakeDocument.dispatch(createEvent('keydown', { target: ghost, key: 'ArrowDown' }));
    expect(ghost.style).toMatchObject({ left: '880px', top: '58px' });
    resetButton.dispatch(createEvent('click', { target: resetButton }));
    expect(ghost.style).toMatchObject({ left: '940px', top: '50px' });

    confirmButton.dispatch(createEvent('click', { target: confirmButton }));
    expect(onComplete.mock.calls[0][0].proposedRect).toEqual({ x: 940, y: 150, width: 120, height: 40 });
  });

  it('keeps the original ratio at the smallest size while Shift is held', () => {
    startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const { ghost } = getOverlay();
    const resizeHandle = ghost.children[1];

    ghost.dispatch(createEvent('pointerdown', { target: resizeHandle, clientX: 220, clientY: 90 }));
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 172, clientY: 74, shiftKey: true }));

    expect(ghost.style).toMatchObject({ width: '48px', height: '16px' });
  });

  it('places the toolbar above an element near the bottom without covering the rotate handle', () => {
    hostElement.bounds = { left: 100, top: 740, width: 120, height: 40 };
    startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const { toolbar } = getOverlay();
    Object.assign(toolbar, { offsetWidth: 300, offsetHeight: 50 });
    fakeDocument.dispatch(createEvent('keydown', { target: getOverlay().ghost, key: 'ArrowLeft' }));

    // The rotate handle reaches 28px above the ghost's top (740), so the toolbar ends 8px above that.
    expect(toolbar.style.top).toBe(`${740 - 28 - 8 - 50}px`);
  });

  it('lets the toolbar wrap inside a narrow viewport', () => {
    startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const { toolbar } = getOverlay();

    expect(toolbar.getAttribute('style')).toContain('flex-wrap: wrap');
    expect(toolbar.getAttribute('style')).toContain('max-width: calc(100% - 16px)');
  });

  it('keeps the ghost inside the viewport while dragging', () => {
    const handle = startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const { ghost } = getOverlay();

    ghost.dispatch(createEvent('pointerdown', { target: ghost, clientX: 110, clientY: 60 }));
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 5000, clientY: -5000 }));

    expect(ghost.style).toMatchObject({ left: '880px', top: '0px' });
    handle.cancel();
  });

  it.each(['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'beforeinput', 'keydown', 'keyup'])('blocks original %s actions only while editing', (type) => {
    const handle = startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const hostClick = createEvent(type, { target: hostElement, key: 'Enter' });
    const unrelatedClick = createEvent(type, { target: new FakeElement('A'), key: 'Enter' });

    fakeDocument.dispatch(hostClick);
    fakeDocument.dispatch(unrelatedClick);

    expect(hostClick.preventDefault).toHaveBeenCalled();
    expect(hostClick.stopImmediatePropagation).toHaveBeenCalled();
    expect(unrelatedClick.stopImmediatePropagation).not.toHaveBeenCalled();

    handle.cancel();
    expect(fakeDocument.listenerCount).toBe(0);
  });

  it.each(['a', 'Backspace', 'Delete', 'ArrowUp'])('blocks the original control editing key %s', (key) => {
    const handle = startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const event = createEvent('keydown', { target: hostElement, key });
    fakeDocument.dispatch(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    handle.cancel();
  });

  it('keeps the overlay controls usable when the selected element is body', () => {
    fakeDocument.body.bounds = { left: 0, top: 0, width: 1000, height: 800 };
    const onComplete = vi.fn();
    const handle = startElementDrag({ ...selection, element: document.body }, { onComplete, onCancel: vi.fn() });
    const { ghost, confirmButton } = getOverlay();
    const pointer = createEvent('pointerdown', { target: ghost });
    const click = createEvent('click', { target: confirmButton });

    fakeDocument.dispatch(pointer);
    fakeDocument.dispatch(click);

    expect(pointer.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(click.stopImmediatePropagation).not.toHaveBeenCalled();
    confirmButton.dispatch(click);
    expect(onComplete).toHaveBeenCalledTimes(1);
    handle.cancel();
  });

  it.each(['pointerup', 'mouseup', 'touchend'])('stops overlay %s before reaching host ancestors', (type) => {
    const handle = startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const { root, ghost } = getOverlay();
    const event = createEvent(type, { target: ghost });
    root.dispatch(event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    handle.cancel();
    expect(root.listenerCount).toBe(0);
  });

  it.each([
    ['Escape key', () => fakeDocument.dispatch(createEvent('keydown', { key: 'Escape' }))],
    ['cancel button', () => getOverlay().cancelButton.dispatch(createEvent('click'))],
    ['window resize', () => fakeWindow.dispatch(createEvent('resize'))],
    ['nested scroll seen in capture phase', () => fakeDocument.dispatch(createEvent('scroll'))],
  ])('cancels and cleans up on %s', (_label, trigger) => {
    const onComplete = vi.fn();
    const onCancel = vi.fn(expectCleanedUp);
    startElementDrag(selection, { onComplete, onCancel });

    trigger();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ignores keys other than Escape', () => {
    const onCancel = vi.fn();
    const handle = startElementDrag(selection, { onComplete: vi.fn(), onCancel });

    fakeDocument.dispatch(createEvent('keydown', { key: 'Enter' }));

    expect(onCancel).not.toHaveBeenCalled();
    handle.cancel();
  });

  it('makes cancel idempotent, including calls from inside onCancel', () => {
    const onCancel = vi.fn(() => handle.cancel());
    const handle = startElementDrag(selection, { onComplete: vi.fn(), onCancel });

    handle.cancel();
    handle.cancel();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expectCleanedUp();
  });

  it('cancels the previous edit when a new one starts', () => {
    const firstCancel = vi.fn();
    startElementDrag(selection, { onComplete: vi.fn(), onCancel: firstCancel });
    const second = startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });

    expect(firstCancel).toHaveBeenCalledTimes(1);
    expect(fakeDocument.body.children).toHaveLength(1);

    second.cancel();
    expectCleanedUp();
  });
});
