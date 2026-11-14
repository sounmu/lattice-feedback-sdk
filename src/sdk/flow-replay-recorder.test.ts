import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_PLAIN_REPLAY_BYTES, MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS } from '@/lib/feedback-limits';
import { startReplayRecording } from '@/sdk/flow-replay-recorder';
import type { ReplayChunk, ReplayProgress } from '@/sdk/flow-replay-session';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

const recorder = vi.hoisted(() => ({ emit: (() => undefined) as (event: ScreenSnapshotEvent) => void, starts: 0, stops: 0 }));
const usedNow = vi.hoisted(() => ({ urls: [] as string[] }));
const page = vi.hoisted(() => ({ images: [] as { id: number; currentSrc: string }[] }));
// Stands for the storage the documents of one tab share.
const saved = vi.hoisted(() => ({
  chunks: [] as ReplayChunk[],
  progress: null as ReplayProgress | null,
  onAppend: undefined as (() => void) | undefined,
}));
const listeners = vi.hoisted(() => new Map<string, (event: { persisted: boolean }) => void>());

vi.mock('@rrweb/record', () => ({
  record: Object.assign(
    (options: { emit: (event: ScreenSnapshotEvent) => void }) => {
      recorder.emit = options.emit;
      recorder.starts += 1;
      return () => {
        recorder.stops += 1;
      };
    },
    {
      mirror: {
        getId: (image: { id: number }) => image.id,
        getNode: (id: number) => {
          const image = page.images.find((candidate) => candidate.id === id);
          return image ? { ...image, closest: () => null } : null;
        },
      },
    },
  ),
}));
vi.mock('@/sdk/screen-capture', () => ({
  BLOCKED_SELECTOR: '[data-lattice-block]',
  MASKED_SELECTOR: '[data-lattice-mask]',
  findUsedCssImageUrls: () => new Set(usedNow.urls),
}));
vi.mock('@/sdk/flow-replay-session', () => ({
  openReplayStore: () => ({
    load: async () => structuredClone(saved.chunks),
    append: (chunk: ReplayChunk) => {
      saved.chunks.push(structuredClone(chunk));
      saved.onAppend?.();
    },
    findProgress: () => saved.progress,
    saveProgress: (progress: ReplayProgress) => {
      saved.progress = progress;
    },
    clear: async () => {
      saved.chunks = [];
      saved.progress = null;
    },
  }),
}));

const START = 1_000_000;
const HOST = 'https://host.example.com';
const SDK = 'lattice-feedback-root';
const FRESH = { projectKey: 'demo', sessionId: 'flow-1', resumed: false, recordPage: true };
const RESUMED = { ...FRESH, resumed: true };

function openDocument(path: string): void {
  listeners.clear();
  vi.stubGlobal('window', {
    location: { href: `${HOST}${path}` }, innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0,
    addEventListener: (type: string, listener: (event: { persisted: boolean }) => void) => void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
  });
}

function leaveDocument(): void {
  listeners.get('pagehide')?.({ persisted: false });
}

function emitPage(at: number, childNodes: unknown[] = []): void {
  recorder.emit({ type: 4, timestamp: at, data: { href: window.location.href, width: 1440, height: 900 } });
  recorder.emit({ type: 2, timestamp: at, data: { node: { type: 0, id: 1, childNodes } } });
}

function emitClick(at: number): void {
  recorder.emit({ type: 3, timestamp: at, data: { source: 2, type: 2, id: 2 } });
}

function waitForAppend(): Promise<void> {
  return new Promise((resolve) => {
    saved.onAppend = resolve;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  Object.assign(saved, { chunks: [], progress: null, onAppend: undefined });
  Object.assign(recorder, { starts: 0, stops: 0 });
  page.images = [];
  usedNow.urls = [];
  openDocument('/orders?token=SECRET');
  vi.stubGlobal('document', {
    title: 'Orders',
    querySelectorAll: () => page.images.map((image) => ({ ...image, closest: () => null })),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps the file each image showed when it was recorded: at the start, or when it was added later', async () => {
  page.images = [{ id: 7, currentSrc: `${HOST}/actual-2x.png` }];
  const recording = startReplayRecording(SDK, FRESH);
  emitPage(START);
  page.images = [{ id: 7, currentSrc: `${HOST}/actual-1x.png` }, { id: 9, currentSrc: `${HOST}/added-first.png` }];
  const added = { type: 2, tagName: 'div', attributes: {}, childNodes: [{ type: 2, id: 9, tagName: 'img', attributes: {} }] };
  recorder.emit({ type: 3, timestamp: START + 10, data: { source: 0, adds: [{ node: added }] } });
  page.images = [{ id: 9, currentSrc: `${HOST}/added-later.png` }];

  expect((await recording.stop())?.segments[0].liveImageSources).toEqual([
    [7, `${HOST}/actual-2x.png`],
    [9, `${HOST}/added-first.png`],
  ]);
});

it('keeps CSS images shown at the start or after a later change even when they are gone at the end', async () => {
  usedNow.urls = [`${HOST}/start.png`];
  const recording = startReplayRecording(SDK, FRESH);
  emitPage(START);
  usedNow.urls = [`${HOST}/banner.png`];
  recorder.emit({ type: 3, timestamp: START + 200, data: { source: 0 } });
  recorder.emit({ type: 3, timestamp: START + 1500, data: { source: 0 } });
  usedNow.urls = [`${HOST}/skipped.png`];
  recorder.emit({ type: 3, timestamp: START + 1700, data: { source: 0 } });
  usedNow.urls = [];

  expect((await recording.stop())?.segments[0].usedCssImageUrls).toEqual([`${HOST}/start.png`, `${HOST}/banner.png`]);
});

it('stops observing the page once the event limit is reached and keeps what was recorded as truncated', async () => {
  const recording = startReplayRecording(SDK, FRESH);
  emitPage(START);
  for (let index = 0; index < MAX_REPLAY_EVENTS; index += 1) {
    emitClick(START + 1);
  }
  await Promise.resolve();

  const result = await recording.stop();

  expect(recorder.stops).toBe(1);
  expect(result?.segments[0].events).toHaveLength(MAX_REPLAY_EVENTS);
  expect(result?.truncated).toBe(true);
});

it.each([
  ['an upload', () => MAX_REPLAY_BYTES],
  ['a plain upload when the browser cannot compress', () => {
    vi.stubGlobal('CompressionStream', undefined);
    return MAX_PLAIN_REPLAY_BYTES;
  }],
])('stops before page changes outgrow %s, keeping the first snapshot and the changes that fit', async (_name, getLimit) => {
  // Three of these fit the budget; the fourth does not.
  const text = 'x'.repeat(Math.floor(getLimit() / 3.5));
  const recording = startReplayRecording(SDK, FRESH);
  emitPage(START);
  for (let index = 0; index < 5; index += 1) {
    recorder.emit({ type: 3, timestamp: START + 1, data: { source: 0, texts: [{ id: 1, value: text }] } });
  }

  const result = await recording.stop();

  expect(result?.segments[0].events.map((event) => event.type)).toEqual([4, 2, 3, 3, 3]);
  expect(result?.truncated).toBe(true);
});

it('saves cleaned events as they are recorded and continues the replay in the next document', async () => {
  startReplayRecording(SDK, FRESH);
  emitPage(START, [{ type: 2, id: 2, tagName: 'input', attributes: { type: 'hidden', value: 'CSRF-1', onclick: 'steal()' } }]);
  emitClick(START + 10);
  await Promise.resolve();

  expect(saved.chunks.flatMap((chunk) => chunk.events.map((event) => event.type))).toEqual([4, 2, 3]);
  expect(JSON.stringify(saved.chunks)).not.toMatch(/SECRET|CSRF-1|steal/);

  leaveDocument();
  openDocument('/orders/42');
  const next = startReplayRecording(SDK, RESUMED);
  emitPage(START + 500, [{ type: 2, id: 2, tagName: 'img', attributes: {} }]);
  emitClick(START + 600);
  const result = await next.stop();

  expect(result?.segments.map((segment) => [segment.page.url, segment.gapBefore, segment.events.map((event) => event.type)])).toEqual([
    [`${HOST}/orders`, false, [4, 2, 3]],
    [`${HOST}/orders/42`, false, [4, 2, 3]],
  ]);
  expect(result?.startedAt).toBe(new Date(START).toISOString());
  expect(result?.truncated).toBe(false);
  expect(saved.chunks).toEqual([]);
});

it('marks the gap when the document before did not get to save everything it recorded', async () => {
  startReplayRecording(SDK, FRESH);
  emitPage(START);
  await Promise.resolve();
  emitClick(START + 10);
  leaveDocument();
  // The write issued while leaving never landed.
  saved.chunks.pop();
  openDocument('/orders/42');
  const next = startReplayRecording(SDK, RESUMED);
  emitPage(START + 500);

  expect((await next.stop())?.segments.map((segment) => segment.gapBefore)).toEqual([false, true]);
});

it('counts the earlier documents against the limits', async () => {
  startReplayRecording(SDK, FRESH);
  emitPage(START);
  for (let index = 0; index < MAX_REPLAY_EVENTS - 5; index += 1) {
    emitClick(START + 1);
  }
  await Promise.resolve();
  leaveDocument();
  openDocument('/orders/42');
  const next = startReplayRecording(SDK, RESUMED);
  emitPage(START + 500);
  emitClick(START + 600);
  emitClick(START + 700);

  const result = await next.stop();

  expect(result?.segments[1].events.map((event) => event.type)).toEqual([4, 2, 3]);
  expect(result?.truncated).toBe(true);
});

it('ends the replay at the pages before one the policy leaves out, and it stays ended afterwards', async () => {
  startReplayRecording(SDK, FRESH);
  emitPage(START);
  await Promise.resolve();
  leaveDocument();
  openDocument('/admin');
  const ended = waitForAppend();
  startReplayRecording(SDK, { ...RESUMED, recordPage: false });
  await ended;

  expect(recorder.starts).toBe(1);
  expect(saved.chunks.at(-1)).toMatchObject({ page: null, ended: true, events: [] });

  openDocument('/orders/42');
  const next = startReplayRecording(SDK, RESUMED);
  emitPage(START + 900);
  const result = await next.stop();

  expect(result?.segments.map((segment) => segment.page.url)).toEqual([`${HOST}/orders`]);
  expect(result?.truncated).toBe(true);
});

it('removes a cancelled replay, and the saved part still being read does not bring it back', async () => {
  startReplayRecording(SDK, FRESH);
  emitPage(START);
  await Promise.resolve();
  leaveDocument();
  openDocument('/orders/42');
  const next = startReplayRecording(SDK, RESUMED);
  emitPage(START + 500);
  next.discard();

  expect(await next.stop()).toBeNull();
  expect(saved.chunks).toEqual([]);
});

it('continues after a back/forward cache restore with a new snapshot after the intervening page', async () => {
  const first = startReplayRecording(SDK, FRESH);
  emitPage(START);
  await Promise.resolve();
  leaveDocument();
  const showFirst = listeners.get('pageshow');
  openDocument('/orders/42');
  const appended = waitForAppend();
  startReplayRecording(SDK, RESUMED);
  emitPage(START + 500);
  await appended;
  leaveDocument();
  openDocument('/orders');
  showFirst?.({ persisted: true });
  emitPage(START + 800);
  emitClick(START + 900);

  const result = await first.stop();

  expect(result?.segments.map((segment) => segment.events.map((event) => event.type))).toEqual([[4, 2], [4, 2], [4, 2, 3]]);
  expect(result?.truncated).toBe(false);
});
