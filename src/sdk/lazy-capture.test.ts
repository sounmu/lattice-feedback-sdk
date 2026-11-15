import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapturePolicy } from '@/lib/capture-policy';
import { createCaptureCommand } from '@/lib/capture-protocol';
import { createFlowSession, getFlowSessionKey, readFlowSession, writeFlowSession } from '@/sdk/flow-session';
import { MemoryStorage } from '@/sdk/flow-test-fixtures';
import { createLazyCapture, type LazyCapture, type LazyCaptureOptions } from '@/sdk/lazy-capture';
import type { CaptureRuntime } from '@/sdk/runtime-loader';
import type { CaptureState } from '@/types/sdk-message';

const PROJECT_KEY = 'demo';
const FLOW_KEY = getFlowSessionKey(PROJECT_KEY);
const NOW = 1_800_000_000_000;

type LoadRuntime = LazyCaptureOptions['loadRuntime'];

function stubWindow(storedFlow = false) {
  const storage = new MemoryStorage();
  if (storedFlow) storage.setItem(FLOW_KEY, '{}');
  const listeners = new Map<string, (event: { persisted: boolean }) => void>();
  vi.stubGlobal('window', {
    location: { pathname: '/orders' },
    sessionStorage: storage,
    addEventListener: (type: string, listener: (event: { persisted: boolean }) => void) => void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
  });
  return { storage, items: storage.items, listeners };
}

function createFakeRuntime() {
  const controller = {
    handleCommand: vi.fn(), sync: vi.fn(), setPanelVisible: vi.fn(), pageChanged: vi.fn(), cancelTransient: vi.fn(),
    reset: vi.fn(), destroy: vi.fn(), takeFlowReplay: vi.fn(async () => null),
    getCommentPinSources: vi.fn(() => []), getEditMoveSources: vi.fn(() => []),
  };
  const previewPanel = { open: vi.fn(), close: vi.fn(), handleMessage: vi.fn(() => false), destroy: vi.fn() };
  const stopWatchingIndex = vi.fn();
  const exports = {
    createCaptureController: vi.fn(() => controller),
    createPreviewPanel: vi.fn(() => previewPanel),
    configureAutomaticMasking: vi.fn(),
    onStaticIndexSettled: vi.fn(() => stopWatchingIndex),
    createAutomaticMasker: () => ({ text: (title: string) => `classified:${title}` }),
    warmStaticTextIndex: vi.fn(),
  };
  return { runtime: exports as unknown as CaptureRuntime, exports, controller, previewPanel, stopWatchingIndex };
}

function createCapture(loadRuntime: LoadRuntime, policy: CapturePolicy | null = null) {
  const onUpdate = vi.fn<(state: CaptureState) => void>();
  const onTitleChange = vi.fn();
  const capture = createLazyCapture({
    projectKey: PROJECT_KEY, policy, sdkSelector: 'lattice-feedback-root', appOrigin: 'https://app.example.com',
    root: {} as unknown as ShadowRoot, widgetPanel: {} as unknown as Element,
    loadRuntime, onUpdate, onTitleChange, onShowWidget: vi.fn(), onHideWidget: vi.fn(), onPreviewClose: vi.fn(),
  });
  return { capture, onUpdate, onTitleChange };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('before the capture tools are loaded', () => {
  it('tells the widget that a capture can start and nothing is attached', () => {
    stubWindow();
    const { capture, onUpdate } = createCapture(vi.fn());

    capture.sync();

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      enabled: true, activeMode: null, selection: null, flowEventCount: 0,
      attachments: { comments: [], edits: [], flow: null }, commentKeys: [], editKeys: [], errorMessage: null,
    });
  });

  it('reports a page the policy leaves out as one that cannot be captured, again after a page change', () => {
    stubWindow();
    const { capture, onUpdate } = createCapture(vi.fn(), { allowedPaths: ['/billing'], targets: [] });

    capture.pageChanged();

    expect(onUpdate.mock.lastCall?.[0].enabled).toBe(false);
  });

  it('masks the whole title, unless the policy turns masking off', () => {
    stubWindow();
    const masked = createCapture(vi.fn()).capture.maskTitle('주문 42');
    const unmasked = createCapture(vi.fn(), { allowedPaths: ['/orders'], targets: [], automaticMasking: { enabled: false } })
      .capture.maskTitle('주문 42');

    expect(masked).toBe('●● ●●');
    expect(unmasked).toBe('주문 42');
  });

  it('has no preview panel and no Flow replay', async () => {
    stubWindow();
    const { capture } = createCapture(vi.fn());

    expect(capture.previewPanel).toBeNull();
    await expect(capture.takeFlowReplay()).resolves.toBeNull();
  });
});

describe('loading the capture tools', () => {
  it('creates the controller once and hands it the panel visibility it missed', async () => {
    stubWindow();
    const { runtime, exports, controller, previewPanel } = createFakeRuntime();
    const { capture, onTitleChange } = createCapture(async () => runtime, { allowedPaths: ['/orders'], targets: [], automaticMasking: { enabled: false } });
    capture.setPanelVisible(true);

    await capture.load();
    await capture.load();

    expect(exports.configureAutomaticMasking).toHaveBeenCalledExactlyOnceWith({ enabled: false });
    expect(exports.createCaptureController).toHaveBeenCalledTimes(1);
    expect(controller.setPanelVisible).toHaveBeenCalledExactlyOnceWith(true);
    expect(controller.sync).toHaveBeenCalledTimes(1);
    expect(capture.previewPanel).toBe(previewPanel);
    expect(onTitleChange).toHaveBeenCalledTimes(1);
    expect(capture.maskTitle('주문 42')).toBe('classified:주문 42');
  });

  it('sends every later call to the controller', async () => {
    stubWindow();
    const { runtime, controller } = createFakeRuntime();
    const { capture, onUpdate } = createCapture(async () => runtime);
    await capture.load();
    const command = createCaptureCommand({ type: 'capture:cancel', payload: {} });

    capture.handleCommand(command);
    capture.pageChanged();
    capture.reportUnavailable();

    expect(controller.handleCommand).toHaveBeenCalledExactlyOnceWith(command);
    expect(controller.pageChanged).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('shows why a capture could not start after a failed load, and attaches when a later load succeeds', async () => {
    stubWindow();
    const { runtime, exports } = createFakeRuntime();
    const loadRuntime = vi.fn<() => Promise<CaptureRuntime>>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(runtime);
    const { capture, onUpdate } = createCapture(loadRuntime);

    await expect(capture.load()).rejects.toThrow(TypeError);
    capture.reportUnavailable();
    await capture.load();

    expect(onUpdate.mock.calls[0][0].errorMessage).toEqual(expect.any(String));
    expect(onUpdate.mock.calls[0][0].enabled).toBe(true);
    expect(exports.createCaptureController).toHaveBeenCalledTimes(1);
  });

  it('drops the failure message when the draft is reset or sent', async () => {
    stubWindow();
    const { capture, onUpdate } = createCapture(vi.fn<() => Promise<CaptureRuntime>>().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(capture.load()).rejects.toThrow(TypeError);

    capture.reportUnavailable();
    capture.handleCommand(createCaptureCommand({ type: 'draft:reset', payload: {} }));
    capture.reportUnavailable();
    capture.reset();

    expect(onUpdate.mock.calls.map(([state]) => state.errorMessage === null)).toEqual([false, true, false, true]);
  });

  it('reports a load that failed again on retry differently from a first failure', async () => {
    stubWindow();
    const { capture, onUpdate } = createCapture(vi.fn<LoadRuntime>().mockRejectedValue(new TypeError('Failed to fetch')));

    await Promise.allSettled([capture.load(), capture.load()]);
    capture.reportUnavailable();
    await expect(capture.load()).rejects.toThrow(TypeError);
    capture.reportUnavailable();

    const [afterFirstLoad, afterRetry] = onUpdate.mock.calls.map(([state]) => state.errorMessage);
    expect(afterFirstLoad).toEqual(expect.any(String));
    expect(afterRetry).toEqual(expect.any(String));
    expect(afterRetry).not.toBe(afterFirstLoad);
  });

  it('shares a load between its callers and tells the next one how many have failed', async () => {
    stubWindow();
    const loadRuntime = vi.fn<LoadRuntime>().mockRejectedValue(new TypeError('Failed to fetch'));
    const { capture } = createCapture(loadRuntime);

    await Promise.allSettled([capture.load(), capture.load()]);
    await expect(capture.load()).rejects.toThrow(TypeError);

    expect(loadRuntime.mock.calls).toEqual([[0], [1]]);
  });

  it('warms the static text index once loaded while the panel is on screen', async () => {
    stubWindow();
    const { runtime, exports } = createFakeRuntime();
    const warmed = new Promise<void>((resolve) => exports.warmStaticTextIndex.mockImplementation(resolve));
    const { capture } = createCapture(async () => runtime);
    capture.setPanelVisible(true);

    capture.warm();

    await expect(warmed).resolves.toBeUndefined();
  });
});

describe('a Flow being recorded in this tab', () => {
  it('loads the tools right away, and only then', () => {
    stubWindow(true);
    const withFlow = vi.fn(async () => createFakeRuntime().runtime);
    createCapture(withFlow);
    stubWindow(false);
    const withoutFlow = vi.fn(async () => createFakeRuntime().runtime);
    createCapture(withoutFlow);

    expect(withFlow).toHaveBeenCalledTimes(1);
    expect(withoutFlow).not.toHaveBeenCalled();
  });

  it('loads the tools when a page restored from the back/forward cache finds it', () => {
    const { items, listeners } = stubWindow();
    const loadRuntime = vi.fn(async () => createFakeRuntime().runtime);
    createCapture(loadRuntime);
    items.set(FLOW_KEY, '{}');

    listeners.get('pageshow')?.({ persisted: true });

    expect(loadRuntime).toHaveBeenCalledTimes(1);
  });

  it('takes session storage that cannot be read as holding no Flow', () => {
    const { storage, listeners } = stubWindow(true);
    storage.failReads = true;
    const loadRuntime = vi.fn(async () => createFakeRuntime().runtime);

    createCapture(loadRuntime);
    listeners.get('pageshow')?.({ persisted: true });

    expect(loadRuntime).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'keeps a stored Flow for the controller to go on with', reset: (): void => undefined, found: 'restored' },
    {
      name: 'ends a stored Flow when the draft is sent before the tools are loaded',
      reset: (capture: LazyCapture): void => capture.reset(), found: 'empty',
    },
    {
      name: 'ends a stored Flow when the reporter starts another draft before the tools are loaded',
      reset: (capture: LazyCapture): void => capture.handleCommand(createCaptureCommand({ type: 'draft:reset', payload: {} })),
      found: 'empty',
    },
  ])('$name', async ({ reset, found }) => {
    const { storage } = stubWindow();
    writeFlowSession(storage, FLOW_KEY, createFlowSession(NOW, false));
    const { runtime, exports, controller } = createFakeRuntime();
    const foundAtAttach: string[] = [];
    exports.createCaptureController.mockImplementation(() => {
      const everything = { isPathAllowed: () => true, isTargetAllowed: () => true };
      foundAtAttach.push(readFlowSession(storage, FLOW_KEY, everything, NOW).kind);
      return controller;
    });
    const { capture } = createCapture(async () => runtime);

    reset(capture);
    await capture.load();

    expect(foundAtAttach).toEqual([found]);
  });
});

describe('destroy', () => {
  it('ends a stored Flow when the tools were never loaded, and a load that finishes later attaches nothing', async () => {
    const { items, listeners } = stubWindow(true);
    const { runtime, exports } = createFakeRuntime();
    const { capture } = createCapture(async () => runtime);

    capture.destroy();
    await capture.load();

    expect(items.has(FLOW_KEY)).toBe(false);
    expect(listeners.has('pageshow')).toBe(false);
    expect(exports.createCaptureController).not.toHaveBeenCalled();
  });

  it('destroys the controller and the preview panel, and leaves a stored Flow to the controller', async () => {
    const { items } = stubWindow(true);
    const { runtime, controller, previewPanel, stopWatchingIndex } = createFakeRuntime();
    const { capture } = createCapture(async () => runtime);
    await capture.load();

    capture.destroy();

    expect(controller.destroy).toHaveBeenCalledTimes(1);
    expect(previewPanel.destroy).toHaveBeenCalledTimes(1);
    expect(stopWatchingIndex).toHaveBeenCalledTimes(1);
    expect(items.has(FLOW_KEY)).toBe(true);
  });
});
