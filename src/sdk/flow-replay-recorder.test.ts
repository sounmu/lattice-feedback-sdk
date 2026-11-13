import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

const recorder = vi.hoisted(() => ({ emit: (() => undefined) as (event: ScreenSnapshotEvent) => void, stops: 0 }));
const usedNow = vi.hoisted(() => ({ urls: [] as string[] }));
const page = vi.hoisted(() => ({ images: [] as { id: number; currentSrc: string }[] }));

vi.mock('@rrweb/record', () => ({
  record: Object.assign(
    (options: { emit: (event: ScreenSnapshotEvent) => void }) => {
      recorder.emit = options.emit;
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

const { startReplayRecording } = await import('@/sdk/flow-replay-recorder');
const { MAX_PLAIN_REPLAY_BYTES, MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS } = await import('@/lib/feedback-limits');

const START = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal('window', { location: { href: 'https://host.example.com/' }, innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0 });
  vi.stubGlobal('document', {
    title: 'Orders',
    querySelectorAll: () => page.images.map((image) => ({ ...image, closest: () => null })),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps the file each image showed when it was recorded: at the start, or when it was added later', () => {
  page.images = [{ id: 7, currentSrc: 'https://host.example.com/actual-2x.png' }];
  const recording = startReplayRecording('lattice-feedback-root');
  recorder.emit({ type: 4, timestamp: START, data: {} });
  recorder.emit({ type: 2, timestamp: START, data: {} });
  page.images = [
    { id: 7, currentSrc: 'https://host.example.com/actual-1x.png' },
    { id: 9, currentSrc: 'https://host.example.com/added-first.png' },
  ];
  const added = { type: 2, tagName: 'div', childNodes: [{ type: 2, id: 9, tagName: 'img', attributes: {} }] };
  recorder.emit({ type: 3, timestamp: START + 10, data: { source: 0, adds: [{ node: added }] } });
  page.images = [{ id: 9, currentSrc: 'https://host.example.com/added-later.png' }];

  expect([...(recording.stop()?.liveImageSources ?? [])]).toEqual([
    [7, 'https://host.example.com/actual-2x.png'],
    [9, 'https://host.example.com/added-first.png'],
  ]);
});

it('keeps CSS images shown at the start or after a later change even when they are gone at the end', () => {
  usedNow.urls = ['https://host.example.com/start.png'];
  const recording = startReplayRecording('lattice-feedback-root');
  recorder.emit({ type: 4, timestamp: START, data: {} });
  recorder.emit({ type: 2, timestamp: START, data: {} });
  usedNow.urls = ['https://host.example.com/banner.png'];
  recorder.emit({ type: 3, timestamp: START + 200, data: { source: 0 } });
  recorder.emit({ type: 3, timestamp: START + 1500, data: { source: 0 } });
  usedNow.urls = ['https://host.example.com/skipped.png'];
  recorder.emit({ type: 3, timestamp: START + 1700, data: { source: 0 } });
  usedNow.urls = [];

  expect([...(recording.stop()?.usedCssImageUrls ?? [])]).toEqual([
    'https://host.example.com/start.png',
    'https://host.example.com/banner.png',
  ]);
});

it('stops observing the page once the event limit is reached and keeps what was recorded as truncated', async () => {
  page.images = [];
  recorder.stops = 0;
  const recording = startReplayRecording('lattice-feedback-root');
  recorder.emit({ type: 4, timestamp: START, data: {} });
  recorder.emit({ type: 2, timestamp: START, data: {} });
  for (let index = 0; index < MAX_REPLAY_EVENTS; index += 1) {
    recorder.emit({ type: 3, timestamp: START + 1, data: { source: 1 } });
  }
  await Promise.resolve();

  const result = recording.stop();

  expect(recorder.stops).toBe(1);
  expect(result?.events).toHaveLength(MAX_REPLAY_EVENTS);
  expect(result?.truncated).toBe(true);
});

it('stops before page changes outgrow an upload, keeping the first snapshot and the changes that fit', async () => {
  page.images = [];
  recorder.stops = 0;
  // Three of these fit the budget; the fourth does not.
  const text = 'x'.repeat(Math.floor(MAX_REPLAY_BYTES / 3.5));
  const recording = startReplayRecording('lattice-feedback-root');
  recorder.emit({ type: 4, timestamp: START, data: {} });
  recorder.emit({ type: 2, timestamp: START, data: {} });
  for (let index = 0; index < 5; index += 1) {
    recorder.emit({ type: 3, timestamp: START + 1, data: { source: 0, texts: [{ id: 1, value: text }] } });
  }
  await Promise.resolve();

  const result = recording.stop();

  expect(recorder.stops).toBe(1);
  expect(result?.events.map((event) => event.type)).toEqual([4, 2, 3, 3, 3]);
  expect(result?.truncated).toBe(true);
});

it('stops within a plain upload when the browser cannot compress', async () => {
  vi.stubGlobal('CompressionStream', undefined);
  page.images = [];
  recorder.stops = 0;
  // Three of these fit a plain upload; with compression all five would fit.
  const text = 'x'.repeat(Math.floor(MAX_PLAIN_REPLAY_BYTES / 3.5));
  const recording = startReplayRecording('lattice-feedback-root');
  recorder.emit({ type: 4, timestamp: START, data: {} });
  recorder.emit({ type: 2, timestamp: START, data: {} });
  for (let index = 0; index < 5; index += 1) {
    recorder.emit({ type: 3, timestamp: START + 1, data: { source: 0, texts: [{ id: 1, value: text }] } });
  }
  await Promise.resolve();

  const result = recording.stop();

  expect(result?.events.map((event) => event.type)).toEqual([4, 2, 3, 3, 3]);
  expect(result?.truncated).toBe(true);
});
