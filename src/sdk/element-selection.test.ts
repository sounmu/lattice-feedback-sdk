import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureTarget } from '@/sdk/capture-policy';
import { startElementSelection } from '@/sdk/element-selection';

type Listener = (event: FakeEvent) => void;

class FakeElement {
  isConnected = true;
  bounds = { left: 10, top: 20, width: 100, height: 40 };
  constructor(private readonly isSdkElement = false) {}
  closest(): FakeElement | null {
    return this.isSdkElement ? this : null;
  }
  getBoundingClientRect() {
    return this.bounds;
  }
}

interface FakeEvent {
  type: string;
  target: unknown;
  key?: string;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

function createEvent(type: string, target: unknown, key?: string): FakeEvent {
  return {
    type,
    target,
    key,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.propagationStopped = true;
    },
  };
}

let listeners: Map<string, Set<Listener>>;
let overlay: { attributes: Record<string, string>; style: Record<string, string>; removed: boolean };
let appended: unknown[];
let hostButton: FakeElement;

function dispatch(type: string, target: unknown, key?: string): FakeEvent {
  const event = createEvent(type, target, key);
  for (const listener of listeners.get(type) ?? []) {
    listener(event);
  }
  return event;
}

function listenerCount(): number {
  let count = 0;
  for (const set of listeners.values()) {
    count += set.size;
  }
  return count;
}

beforeEach(() => {
  listeners = new Map();
  appended = [];
  hostButton = new FakeElement();
  overlay = {
    attributes: {},
    style: {},
    removed: false,
  };
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
  });
  vi.stubGlobal('document', {
    createElement: (tagName: string) => tagName === 'button' ? hostButton : ({
      style: overlay.style,
      setAttribute: (name: string, value: string) => {
        overlay.attributes[name] = value;
      },
      remove: () => {
        overlay.removed = true;
      },
    }),
    body: { appendChild: (node: unknown) => appended.push(node) },
  });
});

afterEach(() => vi.unstubAllGlobals());

function createHarness() {
  const allowed = hostButton;
  const selection: CaptureTarget = {
    element: document.createElement('button'),
    target: {
      feedbackId: 'register', selector: 'button', tagName: 'button',
      rect: { x: 10, y: 20, width: 100, height: 40 },
    },
  };
  const allowedTarget: unknown = allowed;
  const findTarget = vi.fn((target: EventTarget | null) => (target === allowedTarget ? selection : null));
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const handle = startElementSelection({ findTarget, onSelect, onCancel });
  return { allowed, selection, findTarget, onSelect, onCancel, handle };
}

describe('element selection', () => {
  it('mounts a non-interactive overlay without touching host element styles', () => {
    const { allowed } = createHarness();
    expect(appended).toHaveLength(1);
    expect(overlay.attributes['data-lattice-overlay']).toBe('selection');
    expect(overlay.style.cssText).toContain('pointer-events: none');

    dispatch('pointerover', allowed);
    expect(overlay.style.display).toBe('block');
    expect(overlay.style.transform).toBe('translate(10px, 20px)');
    expect(overlay.style.width).toBe('100px');
    expect(allowed).not.toHaveProperty('style');
  });

  it('hides the outline for disallowed targets and refreshes it on scroll and resize', () => {
    const { allowed } = createHarness();
    dispatch('pointerover', allowed);
    allowed.bounds = { left: 5, top: 0, width: 50, height: 10 };
    dispatch('scroll', null);
    expect(overlay.style.transform).toBe('translate(5px, 0px)');

    allowed.bounds = { left: 0, top: 0, width: 0, height: 0 };
    dispatch('resize', null);
    expect(overlay.style.display).toBe('none');

    dispatch('pointerover', allowed);
    dispatch('pointerover', new FakeElement());
    expect(overlay.style.display).toBe('none');
  });

  it('swallows host pointer actions, including on disallowed targets', () => {
    const { onSelect } = createHarness();
    const other = new FakeElement();
    for (const type of ['pointerdown', 'mousedown', 'click', 'touchstart', 'touchend']) {
      const event = dispatch(type, other);
      expect(event.defaultPrevented).toBe(true);
      expect(event.propagationStopped).toBe(true);
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves events on the SDK root and overlays untouched', () => {
    const { findTarget } = createHarness();
    const sdkRoot = new FakeElement(true);
    const click = dispatch('click', sdkRoot);
    const enter = dispatch('keydown', sdkRoot, 'Enter');
    expect(click.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    dispatch('pointerover', sdkRoot);
    expect(findTarget).not.toHaveBeenCalled();
  });

  it('blocks Enter and Space activation on host elements', () => {
    createHarness();
    const target = new FakeElement();
    expect(dispatch('keydown', target, 'Enter').defaultPrevented).toBe(true);
    expect(dispatch('keyup', target, ' ').defaultPrevented).toBe(true);
    expect(dispatch('keydown', target, 'a').defaultPrevented).toBe(false);
  });

  it('selects an allowed click once and cleans up before notifying', () => {
    const { allowed, selection, onSelect } = createHarness();
    onSelect.mockImplementation(() => {
      expect(listenerCount()).toBe(0);
      expect(overlay.removed).toBe(true);
    });
    const event = dispatch('click', allowed);
    dispatch('click', allowed);

    expect(event.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(selection);
  });

  it('selects on touchend without allowing the host touch action', () => {
    const { allowed, selection, onSelect } = createHarness();
    const event = dispatch('touchend', allowed);

    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(selection);
    expect(listenerCount()).toBe(0);
    expect(overlay.removed).toBe(true);
  });

  it('cancels on Escape with cleanup and a single onCancel', () => {
    const { onCancel, onSelect } = createHarness();
    const event = dispatch('keydown', new FakeElement(), 'Escape');
    dispatch('keydown', new FakeElement(), 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
    expect(overlay.removed).toBe(true);
  });

  it('cancel() is idempotent and never invokes callbacks', () => {
    const { handle, onCancel, onSelect, allowed } = createHarness();
    handle.cancel();
    handle.cancel();
    dispatch('click', allowed);

    expect(listenerCount()).toBe(0);
    expect(overlay.removed).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
