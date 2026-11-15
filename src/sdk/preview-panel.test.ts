import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPreviewMessage, createWidgetToHostMessage } from '@/lib/sdk-protocol';
import { createPreviewPanel, type PreviewPanel } from '@/sdk/preview-panel';

const APP_ORIGIN = 'https://app.example.com';
const HOST_ORIGIN = 'https://host.example.com';

type Listener = (event: FakeKeyEvent) => void;

interface FakeKeyEvent {
  key: string;
  isComposing?: boolean;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  listeners = new Map<string, Set<() => void>>();
  className = '';
  textContent = '';
  title = '';
  src = '';
  referrerPolicy = '';
  isFocused = false;
  readonly contentWindow = { postMessage: vi.fn() };
  constructor(readonly tagName: string) {}
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  insertBefore(node: FakeNode, reference: FakeNode): void {
    node.remove();
    node.parent = this;
    this.children.splice(this.children.indexOf(reference), 0, node);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  click(): void {
    for (const listener of [...(this.listeners.get('click') ?? [])]) listener();
  }
  focus(): void {
    this.isFocused = true;
  }
}

let root: FakeNode;
let widgetPanel: FakeNode;
let launcher: FakeNode;
let keyListeners: Set<Listener>;
let onClose: ReturnType<typeof vi.fn<(previewId: string) => void>>;
let panel: PreviewPanel;

const classNames = () => root.children.map((node) => node.className || node.tagName);
const findPreviewFrame = () => root.children.find((node) => node.className === 'preview-panel')?.children[0];
const createPort = () => ({ close: vi.fn() });
const asPort = (port: ReturnType<typeof createPort>) => port as unknown as MessagePort;

function getPreviewFrame(): FakeNode {
  const frame = findPreviewFrame();
  if (!frame) throw new Error('No preview iframe is mounted.');
  return frame;
}

function createMessageEvent(source: unknown, data: unknown): MessageEvent {
  return { origin: APP_ORIGIN, source, data } as MessageEvent;
}

function pressKey(init: Pick<FakeKeyEvent, 'key' | 'isComposing'>): FakeKeyEvent {
  const event: FakeKeyEvent = {
    ...init, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  for (const listener of [...keyListeners]) listener(event);
  return event;
}

beforeEach(() => {
  root = new FakeNode('shadow-root');
  widgetPanel = new FakeNode('div');
  widgetPanel.className = 'panel';
  launcher = new FakeNode('button');
  launcher.className = 'launcher';
  root.append(widgetPanel, launcher);
  keyListeners = new Set();
  onClose = vi.fn<(previewId: string) => void>();
  vi.stubGlobal('window', {
    location: { origin: HOST_ORIGIN },
    addEventListener: (type: string, listener: Listener) => { if (type === 'keydown') keyListeners.add(listener); },
    removeEventListener: (type: string, listener: Listener) => { if (type === 'keydown') keyListeners.delete(listener); },
  });
  vi.stubGlobal('document', { createElement: (tagName: string) => new FakeNode(tagName) });
  panel = createPreviewPanel({
    root: root as unknown as ShadowRoot, widgetPanel: widgetPanel as unknown as Element,
    appOrigin: APP_ORIGIN, projectKey: 'demo', onClose,
  });
});
afterEach(() => vi.unstubAllGlobals());

it('dims the page under the widget and mounts the preview iframe of the app over everything else', () => {
  panel.open('preview-1', asPort(createPort()));

  expect(classNames()).toEqual(['preview-backdrop', 'panel', 'launcher', 'style', 'preview-panel']);
  const frame = getPreviewFrame();
  const url = new URL(frame.src);
  expect(url.origin + url.pathname).toBe(`${APP_ORIGIN}/widget/preview`);
  expect(Object.fromEntries(url.searchParams)).toEqual({ projectKey: 'demo', hostOrigin: HOST_ORIGIN });
  expect(frame.referrerPolicy).toBe('origin');
});

it('hands the port to the ready preview iframe once, at the app origin, and moves focus into it', () => {
  const port = createPort();
  panel.open('preview-1', asPort(port));
  const frame = getPreviewFrame();
  const ready = createPreviewMessage('preview:ready', {});

  expect(panel.handleMessage(createMessageEvent({}, ready))).toBe(false);
  expect(panel.handleMessage(createMessageEvent(frame.contentWindow, createWidgetToHostMessage('ready', {})))).toBe(true);
  expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();

  expect(panel.handleMessage(createMessageEvent(frame.contentWindow, ready))).toBe(true);
  expect(frame.contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith(createPreviewMessage('preview:connect', {}), APP_ORIGIN, [port]);
  expect(frame.isFocused).toBe(true);

  panel.handleMessage(createMessageEvent(frame.contentWindow, ready));
  expect(frame.contentWindow.postMessage).toHaveBeenCalledTimes(1);

  panel.close();
  expect(port.close).not.toHaveBeenCalled();
});

it('closes on a dimmer click, on the iframe\'s request and on Escape, reporting each preview once', () => {
  const untakenPort = createPort();
  panel.open('preview-1', asPort(untakenPort));
  root.children[0].click();
  expect(onClose).toHaveBeenCalledExactlyOnceWith('preview-1');
  expect(untakenPort.close).toHaveBeenCalledOnce();
  expect(classNames()).toEqual(['panel', 'launcher', 'style']);
  expect(keyListeners.size).toBe(0);

  panel.open('preview-2', asPort(createPort()));
  panel.handleMessage(createMessageEvent(getPreviewFrame().contentWindow, createPreviewMessage('preview:close', {})));
  expect(onClose).toHaveBeenLastCalledWith('preview-2');

  panel.open('preview-3', asPort(createPort()));
  expect(pressKey({ key: 'Escape', isComposing: true }).defaultPrevented).toBe(false);
  expect(pressKey({ key: 'Enter' }).stopped).toBe(false);
  const escape = pressKey({ key: 'Escape' });
  expect(escape.defaultPrevented).toBe(true);
  expect(escape.stopped).toBe(true);
  expect(onClose).toHaveBeenLastCalledWith('preview-3');

  panel.close();
  expect(onClose).toHaveBeenCalledTimes(3);
});

it('replaces an open preview instead of stacking a second one', () => {
  const firstPort = createPort();
  panel.open('preview-1', asPort(firstPort));
  const firstFrame = getPreviewFrame();
  panel.open('preview-2', asPort(createPort()));

  expect(onClose).toHaveBeenCalledExactlyOnceWith('preview-1');
  expect(firstPort.close).toHaveBeenCalledOnce();
  expect(classNames().filter((name) => name.startsWith('preview-'))).toEqual(['preview-backdrop', 'preview-panel']);
  expect(panel.handleMessage(createMessageEvent(firstFrame.contentWindow, createPreviewMessage('preview:ready', {})))).toBe(false);
  expect(keyListeners.size).toBe(1);
});

it('removes its nodes and listeners on destroy without reporting a close, and opens nothing afterwards', () => {
  const port = createPort();
  panel.open('preview-1', asPort(port));
  panel.destroy();
  panel.destroy();

  expect(classNames()).toEqual(['panel', 'launcher']);
  expect(keyListeners.size).toBe(0);
  expect(port.close).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();

  const latePort = createPort();
  panel.open('preview-2', asPort(latePort));
  expect(latePort.close).toHaveBeenCalledOnce();
  expect(classNames()).toEqual(['panel', 'launcher']);
});
