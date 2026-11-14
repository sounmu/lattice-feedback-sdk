import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlowRecorder, type FlowRecorderOptions, type FlowRecorderState } from '@/sdk/flow-recorder';
import { FLOW_INACTIVITY_TTL_MS, MAX_FLOW_EVENTS, MAX_FLOW_SESSION_BYTES, getFlowSessionKey, type RecordedFlowAttachment } from '@/sdk/flow-session';
import {
  MemoryStorage, createFlowTestEvent, createFlowTestTarget as fakeTarget, createFlowNavigationEntry,
  findFlowTestTarget, readStoredTestSession,
} from '@/sdk/flow-test-fixtures';

const PROJECT_KEY = 'demo-project';
const KEY = getFlowSessionKey(PROJECT_KEY);
const ALLOWED_PATHS = ['/contracts', '/contracts/new'];
const ALLOWED_TARGETS = ['save-button', 'amount-field'];

type Listener = (event: Event) => void;
let clock = 0;
let storage: MemoryStorage;
let storageBlocked = false;
let listeners: Map<string, Set<Listener>>;
let location: { pathname: string; search: string; hash: string };

function dispatch(type: string, event: Record<string, unknown>): void {
  for (const listener of [...(listeners.get(type) ?? [])]) {
    listener(createFlowTestEvent(type, event));
  }
}

function listenerCount(): number {
  return [...listeners.values()].reduce((total, set) => total + set.size, 0);
}

function createHarness(overrides: Partial<FlowRecorderOptions> = {}) {
  const completed: RecordedFlowAttachment[] = [];
  const states: FlowRecorderState[] = [];
  const recorder = createFlowRecorder({
    projectKey: PROJECT_KEY,
    isPageAllowed: () => ALLOWED_PATHS.includes(location.pathname),
    isPathAllowed: (path) => ALLOWED_PATHS.includes(path),
    isTargetAllowed: (id) => ALLOWED_TARGETS.includes(id),
    findTarget: (target) => findFlowTestTarget(target, ALLOWED_TARGETS),
    onComplete: (attachment) => completed.push(attachment),
    onStateChange: (state) => states.push(state),
    ...overrides,
  });
  return { recorder, completed, states, lastState: () => states[states.length - 1] };
}

function stored(): Record<string, unknown> | null {
  return readStoredTestSession(storage, KEY);
}

beforeEach(() => {
  clock = 1_000_000;
  storage = new MemoryStorage();
  storageBlocked = false;
  listeners = new Map();
  location = { pathname: '/contracts', search: '?token=secret-token', hash: '#private-hash' };
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location,
      get sessionStorage() {
        if (storageBlocked) {
          throw new DOMException('blocked', 'SecurityError');
        }
        return storage;
      },
      addEventListener: (type: string, listener: Listener) => {
        listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
      },
      removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('flow recorder', () => {
  it('records allowed clicks and input occurrences without values, query, or hash', () => {
    const { recorder, completed } = createHarness();
    recorder.start();
    clock += 100;
    dispatch('click', { target: fakeTarget('save-button') });
    clock += 100;
    dispatch('input', { target: fakeTarget('amount-field', '1,000,000 KRW customer secret') });
    dispatch('click', { target: fakeTarget('unlisted-button') });
    const snapshot = storage.getItem(KEY) ?? '';
    recorder.stop();

    expect(completed).toHaveLength(1);
    expect(completed[0].events).toEqual([
      { type: 'click', offsetMs: 100, path: '/contracts', targetLabel: 'save-button' },
      { type: 'input', offsetMs: 200, path: '/contracts', targetLabel: 'amount-field' },
    ]);
    for (const text of [snapshot, JSON.stringify(completed[0])]) {
      expect(text).not.toMatch(/secret|1,000,000|token|private-hash/);
    }
  });

  it('records a generic element by tag when it has no configured feedback id', () => {
    const { recorder, completed } = createHarness({
      isTargetAllowed: (label) => label === 'td',
      findTarget: () => ({
        selector: 'html > body > table > tbody > tr > td',
        feedbackId: null,
        tagName: 'td',
        rect: { x: 0, y: 0, width: 100, height: 24 },
      }),
    });
    recorder.start();

    dispatch('click', { target: fakeTarget('unlisted-cell') });
    recorder.stop();

    expect(completed[0].events).toEqual([
      { type: 'click', offsetMs: 0, path: '/contracts', targetLabel: 'td' },
    ]);
  });

  it('restores across reload and document navigation with monotonic offsets despite clock changes', () => {
    const first = createHarness();
    first.recorder.start();
    const sessionId = first.lastState().sessionId;
    expect(sessionId).toEqual(expect.any(String));
    clock += 1_000;
    dispatch('click', { target: fakeTarget('save-button') });

    clock -= 600;
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([createFlowNavigationEntry('reload')]);
    const reloaded = createHarness();
    expect(reloaded.lastState()).toMatchObject({ recording: true, sessionId, eventCount: 2, storageAvailable: true });

    clock += 5_000;
    location.pathname = '/contracts/new';
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([createFlowNavigationEntry('navigate')]);
    const navigated = createHarness();
    expect(navigated.lastState().sessionId).toBe(sessionId);
    dispatch('click', { target: fakeTarget('save-button') });
    navigated.recorder.stop();
    expect(navigated.lastState().sessionId).toBeNull();

    expect(first.completed).toHaveLength(0);
    expect(reloaded.completed).toHaveLength(0);
    expect(navigated.completed[0].events.map((event) => [event.type, event.offsetMs, event.navigationType])).toEqual([
      ['click', 1_000, undefined],
      ['navigation', 1_000, 'reload'],
      ['navigation', 5_400, 'document'],
      ['click', 5_400, undefined],
    ]);
    expect(storage.getItem(KEY)).toBeNull();
    expect((listeners.get('click')?.size ?? 0) + (listeners.get('input')?.size ?? 0)).toBe(0);
  });

  it('pauses on disallowed pages without collecting their path and marks the flow interrupted', () => {
    const first = createHarness();
    first.recorder.start();
    location.pathname = '/admin/customers';
    const blocked = createHarness();
    dispatch('click', { target: fakeTarget('save-button') });
    expect(blocked.lastState()).toMatchObject({ recording: true, eventCount: 0 });
    expect(storage.getItem(KEY)).not.toContain('/admin');

    location.pathname = '/contracts/new';
    blocked.recorder.recordNavigation();
    blocked.recorder.recordNavigation();
    blocked.recorder.stop();

    expect(blocked.completed[0]).toMatchObject({ interrupted: true });
    expect(blocked.completed[0].events).toEqual([
      { type: 'navigation', offsetMs: 0, path: '/contracts/new', targetLabel: null, navigationType: 'spa' },
    ]);
  });

  it('throttles input per target and stops with truncated at the event cap without evicting', () => {
    const { recorder, completed } = createHarness();
    recorder.start();
    dispatch('input', { target: fakeTarget('amount-field') });
    clock += 100;
    dispatch('input', { target: fakeTarget('amount-field') });
    dispatch('input', { target: fakeTarget('save-button') });
    clock += 250;
    dispatch('input', { target: fakeTarget('amount-field') });
    expect(stored()?.events).toHaveLength(3);

    for (let index = 0; index <= MAX_FLOW_EVENTS; index += 1) {
      clock += 1;
      dispatch('click', { target: fakeTarget('save-button') });
    }
    expect(completed[0].truncated).toBe(true);
    expect(completed[0].events).toHaveLength(MAX_FLOW_EVENTS);
    expect(completed[0].events[0]).toMatchObject({ type: 'input', offsetMs: 0 });
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('stops with truncated before persisted bytes exceed the cap', () => {
    const longPath = `/${'a'.repeat(2_000)}`;
    location.pathname = longPath;
    const { recorder, completed } = createHarness({ isPageAllowed: () => true, isPathAllowed: () => true });
    recorder.start();
    let largestSnapshot = 0;
    for (let index = 0; index <= MAX_FLOW_EVENTS; index += 1) {
      dispatch('click', { target: fakeTarget('save-button') });
      largestSnapshot = Math.max(largestSnapshot, new TextEncoder().encode(storage.getItem(KEY) ?? '').length);
    }
    expect(completed[0].truncated).toBe(true);
    expect(completed[0].events.length).toBeLessThan(MAX_FLOW_EVENTS);
    expect(largestSnapshot).toBeLessThanOrEqual(MAX_FLOW_SESSION_BYTES);
  });

  it('discards expired, corrupt, version-mismatched, or policy-revoked stored sessions', () => {
    createHarness().recorder.start();
    clock += FLOW_INACTIVITY_TTL_MS + 1;
    const expired = createHarness();
    expect(expired.lastState()).toMatchObject({ recording: false, errorMessage: expect.any(String) });
    expect(storage.getItem(KEY)).toBeNull();

    const valid = createHarness();
    valid.recorder.start();
    const tampered = [
      '{not json',
      JSON.stringify({ ...stored(), version: 2 }),
      JSON.stringify({ ...stored(), events: [{ type: 'navigation', offsetMs: 0, path: '/admin', targetLabel: null, navigationType: 'document' }] }),
    ];
    for (const text of tampered) {
      storage.items.set(KEY, text);
      const restored = createHarness();
      expect(restored.lastState()).toMatchObject({ recording: false, errorMessage: expect.any(String) });
      expect(storage.getItem(KEY)).toBeNull();
      expect((listeners.get('click')?.size ?? 0) + (listeners.get('input')?.size ?? 0)).toBe(0);
    }
  });

  it('reports unavailable or failing storage while recording continues in memory', () => {
    storageBlocked = true;
    const blocked = createHarness();
    blocked.recorder.start();
    expect(blocked.lastState()).toMatchObject({ recording: true, storageAvailable: false, errorMessage: expect.any(String) });
    dispatch('click', { target: fakeTarget('save-button') });
    blocked.recorder.stop();
    expect(blocked.completed[0].events).toHaveLength(1);

    storageBlocked = false;
    const failing = createHarness();
    failing.recorder.start();
    storage.failWrites = true;
    dispatch('click', { target: fakeTarget('save-button') });
    expect(failing.lastState()).toMatchObject({ recording: true, eventCount: 1, storageAvailable: false });
    expect(storage.getItem(KEY)).toBeNull();
    failing.recorder.stop();
    expect(failing.completed[0].events).toHaveLength(1);
  });

  it('reports storage read failures without breaking SDK initialization', () => {
    storage.failReads = true;
    const harness = createHarness();
    expect(harness.lastState()).toMatchObject({
      recording: false, storageAvailable: false, errorMessage: expect.any(String),
    });
  });

  it('cleans up on stop, cancel, and destroy, and emits the completed payload only once', () => {
    const stopped = createHarness();
    stopped.recorder.start();
    stopped.recorder.stop();
    stopped.recorder.stop();
    expect(stopped.completed).toHaveLength(1);

    const cancelled = createHarness();
    cancelled.recorder.start();
    dispatch('pagehide', { persisted: true });
    expect(storage.getItem(KEY)).not.toBeNull();
    cancelled.recorder.cancel();
    expect(cancelled.completed).toHaveLength(0);
    expect(storage.getItem(KEY)).toBeNull();
    expect((listeners.get('click')?.size ?? 0) + (listeners.get('input')?.size ?? 0)).toBe(0);

    const destroyed = createHarness();
    destroyed.recorder.start();
    destroyed.recorder.destroy();
    destroyed.recorder.start();
    expect(destroyed.completed).toHaveLength(0);
    expect(storage.getItem(KEY)).toBeNull();
    expect(listenerCount()).toBe(0);
  });

  it('keeps one listener set per project and reconciles state on bfcache pageshow', () => {
    const first = createHarness();
    first.recorder.start();
    const second = createHarness();
    expect(listenerCount()).toBe(3);
    dispatch('click', { target: fakeTarget('save-button') });
    expect(second.lastState().eventCount).toBe(2);

    storage.removeItem(KEY);
    dispatch('pageshow', { persisted: true });
    expect(second.lastState()).toMatchObject({ recording: false });
    expect((listeners.get('click')?.size ?? 0) + (listeners.get('input')?.size ?? 0)).toBe(0);
    expect(second.completed).toHaveLength(0);
  });
});
