import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureTarget } from '@/sdk/capture-policy';
import { startElementDrag } from '@/sdk/element-drag';
import type { EditAttachment } from '@/types/feedback';

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  type: string;
  target: unknown;
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  key: string;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
  stopImmediatePropagation: ReturnType<typeof vi.fn>;
}

function isCapture(options: unknown): boolean {
  if (typeof options === 'boolean') {
    return options;
  }
  return typeof options === 'object' && options !== null && 'capture' in options && options.capture === true;
}

class FakeEventTarget {
  private readonly listeners: { type: string; listener: Listener; capture: boolean }[] = [];

  addEventListener(type: string, listener: Listener, options?: unknown): void {
    this.listeners.push({ type, listener, capture: isCapture(options) });
  }

  removeEventListener(type: string, listener: Listener, options?: unknown): void {
    const index = this.listeners.findIndex(
      (entry) => entry.type === type && entry.listener === listener && entry.capture === isCapture(options),
    );
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  dispatch(event: FakeEvent): void {
    for (const entry of this.listeners.filter((candidate) => candidate.type === event.type)) {
      entry.listener(event);
    }
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

class FakeElement extends FakeEventTarget {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = '';
  bounds = { left: 0, top: 0, width: 0, height: 0 };
  setPointerCapture = vi.fn();

  constructor(readonly tagName: string) {
    super();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): void {
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    if (this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }

  contains(node: FakeElement): boolean {
    for (let current: FakeElement | null = node; current; current = current.parent) {
      if (current === this) {
        return true;
      }
    }
    return false;
  }

  getBoundingClientRect() {
    return { ...this.bounds, x: this.bounds.left, y: this.bounds.top };
  }

  get allText(): string {
    return [this.textContent, ...this.children.map((child) => child.allText)].join(' ');
  }
}

function createEvent(type: string, overrides: Partial<FakeEvent> = {}): FakeEvent {
  return {
    type,
    target: null,
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    key: '',
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  };
}

let fakeWindow: FakeEventTarget & { scrollX: number; scrollY: number; innerWidth: number; innerHeight: number };
let fakeDocument: FakeEventTarget & { body: FakeElement; createElement: (tagName: string) => FakeElement };
let hostElement: FakeElement;
let selection: CaptureTarget;

function getOverlay() {
  const root = fakeDocument.body.children[0];
  const [ghost, toolbar] = root.children;
  const [confirmButton, cancelButton] = toolbar.children;
  return { root, ghost, toolbar, confirmButton, cancelButton };
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

  it('keeps the ghost inside the viewport while dragging', () => {
    const handle = startElementDrag(selection, { onComplete: vi.fn(), onCancel: vi.fn() });
    const { ghost } = getOverlay();

    ghost.dispatch(createEvent('pointerdown', { target: ghost, clientX: 110, clientY: 60 }));
    fakeWindow.dispatch(createEvent('pointermove', { clientX: 5000, clientY: -5000 }));

    expect(ghost.style).toMatchObject({ left: '880px', top: '0px' });
    handle.cancel();
  });

  it.each(['pointerdown', 'mousedown', 'click', 'keydown', 'keyup'])('blocks original %s actions only while editing', (type) => {
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
