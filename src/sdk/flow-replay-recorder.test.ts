import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

const recorder = vi.hoisted(() => ({ emit: (() => undefined) as (event: ScreenSnapshotEvent) => void }));
const usedNow = vi.hoisted(() => ({ urls: [] as string[] }));

vi.mock('@rrweb/record', () => ({
  record: (options: { emit: (event: ScreenSnapshotEvent) => void }) => {
    recorder.emit = options.emit;
    return () => undefined;
  },
}));
vi.mock('@/sdk/screen-capture', () => ({
  BLOCKED_SELECTOR: '[data-lattice-block]',
  MASKED_SELECTOR: '[data-lattice-mask]',
  findUsedCssImageUrls: () => new Set(usedNow.urls),
}));

const { startReplayRecording } = await import('@/sdk/flow-replay-recorder');

const START = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal('window', { location: { href: 'https://host.example.com/' }, innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0 });
  vi.stubGlobal('document', { title: 'Orders' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
