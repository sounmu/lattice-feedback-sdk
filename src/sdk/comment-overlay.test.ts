import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_COMMENT_LENGTH } from '@/lib/feedback-limits';
import type { CaptureTarget } from '@/sdk/capture-policy';
import { createCommentOverlay } from '@/sdk/comment-overlay';
import type { CommentPinSource } from '@/sdk/screen-marks';

interface FakeEvent {
  type: string;
  key?: string;
  ctrlKey?: boolean;
  isComposing?: boolean;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
type Listener = (event: FakeEvent) => void;

class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners = new Map<string, Set<Listener>>();
  className = '';
  textContent = '';
  value = '';
  hidden = false;
  offsetWidth = 300;
  offsetHeight = 150;
  constructor(readonly tagName: string) {}
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeNode[]): void {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  focus(): void {
    for (const node of root.find((node) => node.attributes.focused === 'true')) {
      delete node.attributes.focused;
    }
    this.attributes.focused = 'true';
  }
  bubble(event: FakeEvent): void {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
    if (!event.stopped) this.parent?.bubble(event);
  }
  /** Bubbles like a DOM event until a listener stops it. */
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...init,
    };
    this.bubble(event);
    return event;
  }
  find(matches: (node: FakeNode) => boolean): FakeNode[] {
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.find(matches)]);
  }
}

interface HostElement {
  isConnected: boolean;
  parentElement: unknown;
  bounds: { left: number; top: number; width: number; height: number };
  getBoundingClientRect(): HostElement['bounds'];
}

let root: FakeNode;
let view: { innerWidth: number; innerHeight: number; listeners: Map<string, Set<() => void>> };
let element: HostElement;

const pins = () => root.find((node) => node.className === 'comment-pin');
const remarks = () => root.find((node) => node.attributes.role === 'group');
const editors = () => root.find((node) => node.attributes.role === 'dialog');
const action = (box: FakeNode, name: string) => box.find((node) => node.attributes['data-action'] === name)[0];
const textarea = () => editors()[0].find((node) => node.tagName === 'textarea')[0];
const hostListenerCount = () => [...view.listeners.values()].reduce((count, set) => count + set.size, 0);
const fire = (type: string) => [...(view.listeners.get(type) ?? [])].forEach((listener) => listener());

function createSource(overrides: Partial<CommentPinSource> = {}): CommentPinSource {
  return {
    number: 1, key: 'comment-1', label: 'button', comment: 'Move this', offset: { x: 0.25, y: 0.5 },
    element: element as unknown as Element, ...overrides,
  };
}

function createTarget(): CaptureTarget {
  return {
    element: element as unknown as HTMLElement,
    target: { selector: 'body > button', feedbackId: null, tagName: 'button', rect: { x: 100, y: 200, width: 200, height: 100 } },
  };
}

beforeEach(() => {
  root = new FakeNode('shadow-root');
  element = {
    isConnected: true, parentElement: null, bounds: { left: 100, top: 200, width: 200, height: 100 },
    getBoundingClientRect() { return this.bounds; },
  };
  view = { innerWidth: 1000, innerHeight: 800, listeners: new Map() };
  vi.stubGlobal('window', {
    get innerWidth() { return view.innerWidth; },
    get innerHeight() { return view.innerHeight; },
    addEventListener: (type: string, listener: () => void) => view.listeners.set(type, (view.listeners.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: () => void) => view.listeners.get(type)?.delete(listener),
  });
  vi.stubGlobal('document', { createElement: (tagName: string) => new FakeNode(tagName), body: {} });
  vi.stubGlobal('getComputedStyle', (node: { computed?: object }) => node.computed ?? { overflowX: 'visible', overflowY: 'visible' });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps a numbered pin on the element offset and hides it when offscreen, disconnected, or clipped', () => {
  const overlay = createCommentOverlay(root as unknown as ShadowRoot);
  overlay.renderPins([createSource()], vi.fn());
  const [pin] = pins();
  expect(pin.textContent).toBe('1');
  expect(pin.style.transform).toBe('translate(150px, 250px)');

  element.bounds = { ...element.bounds, top: 300 };
  fire('scroll');
  expect(pin.style.transform).toBe('translate(150px, 350px)');

  element.bounds = { ...element.bounds, top: 900 };
  fire('resize');
  expect(pin.hidden).toBe(true);

  element.bounds = { ...element.bounds, top: 200 };
  element.isConnected = false;
  fire('scroll');
  expect(pin.hidden).toBe(true);

  element.isConnected = true;
  element.parentElement = {
    parentElement: null, computed: { overflowX: 'hidden', overflowY: 'auto' },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 120, bottom: 800 }),
  };
  fire('scroll');
  expect(pin.hidden).toBe(true);

  element.parentElement = null;
  fire('scroll');
  expect(pin.hidden).toBe(false);
  overlay.destroy();
});

it('shows the remark and a remove control when a pin is clicked', () => {
  const overlay = createCommentOverlay(root as unknown as ShadowRoot);
  const staleRemove = vi.fn();
  const remove = vi.fn();
  overlay.renderPins([createSource()], staleRemove);
  overlay.renderPins([createSource()], remove);
  const [pin] = pins();
  const [remark] = remarks();
  expect(remark.hidden).toBe(true);

  pin.dispatch('click');
  expect(remark.hidden).toBe(false);
  expect(remark.find((node) => node.tagName === 'p')[0].textContent).toBe('Move this');
  expect(remark.style.transform).toBe('translate(166px, 266px)');
  expect(pin.attributes['aria-expanded']).toBe('true');

  action(remark, 'remove').dispatch('click');
  expect(remove).toHaveBeenCalledExactlyOnceWith('comment-1');
  expect(staleRemove).not.toHaveBeenCalled();

  expect(pin.dispatch('keydown', { key: 'Escape' }).defaultPrevented).toBe(true);
  expect(remark.hidden).toBe(true);
  overlay.destroy();
});

it('submits a trimmed, bounded comment and lets the callback open the next editor', () => {
  const overlay = createCommentOverlay(root as unknown as ShadowRoot);
  const submitted: string[] = [];
  const onCancel = vi.fn();
  const callbacks = {
    onSubmit: (comment: string) => {
      submitted.push(comment);
      if (submitted.length === 1) overlay.openEditor(createTarget(), { x: 0.5, y: 0.5 }, callbacks);
    },
    onCancel,
  };
  overlay.openEditor(createTarget(), { x: 0.5, y: 0.5 }, callbacks);
  expect(textarea().attributes.focused).toBe('true');

  textarea().value = '   ';
  action(editors()[0], 'submit').dispatch('click');
  expect(submitted).toEqual([]);
  expect(textarea().attributes['aria-invalid']).toBe('true');

  textarea().value = '  Move this  ';
  action(editors()[0], 'submit').dispatch('click');
  expect(submitted).toEqual(['Move this']);
  expect(editors()).toHaveLength(1);
  expect(textarea().attributes.focused).toBe('true');

  textarea().value = 'a'.repeat(MAX_COMMENT_LENGTH + 200);
  textarea().dispatch('keydown', { key: 'Enter', ctrlKey: true });
  expect(submitted[1].length).toBeGreaterThan(0);
  expect(submitted[1].length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
  expect(editors()).toHaveLength(0);
  expect(onCancel).not.toHaveBeenCalled();
  overlay.destroy();
});

it('cancels on Escape once, ignores IME composition, and keeps typed keys from the host page', () => {
  const overlay = createCommentOverlay(root as unknown as ShadowRoot);
  const onCancel = vi.fn();
  overlay.openEditor(createTarget(), { x: 0.5, y: 0.5 }, { onSubmit: vi.fn(), onCancel });
  const field = textarea();

  expect(field.dispatch('keydown', { key: 'g' }).stopped).toBe(true);
  field.dispatch('keydown', { key: 'Escape', isComposing: true });
  expect(editors()).toHaveLength(1);

  field.dispatch('keydown', { key: 'Escape' });
  field.dispatch('keydown', { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(editors()).toHaveLength(0);
  expect(hostListenerCount()).toBe(0);
  overlay.destroy();
});

it('keeps the editor inside a narrow viewport', () => {
  view.innerWidth = 320;
  const overlay = createCommentOverlay(root as unknown as ShadowRoot);
  overlay.openEditor(createTarget(), { x: 1, y: 0 }, { onSubmit: vi.fn(), onCancel: vi.fn() });

  expect(editors()[0].style.transform).toBe('translate(8px, 216px)');
  overlay.destroy();
});

it('removes its nodes and host listeners on destroy without calling callbacks', () => {
  const overlay = createCommentOverlay(root as unknown as ShadowRoot);
  const onCancel = vi.fn();
  overlay.renderPins([createSource()], vi.fn());
  overlay.openEditor(createTarget(), { x: 0.5, y: 0.5 }, { onSubmit: vi.fn(), onCancel });
  expect(hostListenerCount()).toBe(2);

  overlay.destroy();
  overlay.destroy();
  overlay.renderPins([createSource()], vi.fn());
  expect(root.children).toEqual([]);
  expect(hostListenerCount()).toBe(0);
  expect(onCancel).not.toHaveBeenCalled();
});
