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
    { mirror: { getId: (image: { id: number }) => image.id } },
  ),
}));
vi.mock('@/sdk/screen-capture', () => ({
  BLOCKED_SELECTOR: '[data-lattice-block]',
  MASKED_SELECTOR: '[data-lattice-mask]',
  findUsedCssImageUrls: () => new Set(usedNow.urls),
}));

const { startReplayRecording } = await import('@/sdk/flow-replay-recorder');
const { MAX_REPLAY_EVENTS } = await import('@/lib/feedback-limits');

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

it('keeps the file each image showed first, from the start or, for later images, from the end', () => {
  page.images = [{ id: 7, currentSrc: 'https://host.example.com/actual-2x.png' }];
  const recording = startReplayRecording('lattice-feedback-root');
  recorder.emit({ type: 4, timestamp: START, data: {} });
  recorder.emit({ type: 2, timestamp: START, data: {} });
  page.images = [
    { id: 7, currentSrc: 'https://host.example.com/actual-1x.png' },
    { id: 9, currentSrc: 'https://host.example.com/added.png' },
  ];

  expect([...(recording.stop()?.liveImageSources ?? [])]).toEqual([
    [7, 'https://host.example.com/actual-2x.png'],
    [9, 'https://host.example.com/added.png'],
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
