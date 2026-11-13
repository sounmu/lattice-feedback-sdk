import { expect, it } from 'vitest';
import { isCaptureCurrent, type CaptureSource } from '@/lib/screen-capture-generation';

const SOURCES: readonly CaptureSource[] = ['manual', 'marks', 'flow'];

it('drops the replay of a removed Flow and keeps the replay of the Flow recorded after it', () => {
  const afterRemoval = { draft: 0, flow: 1 };

  expect(isCaptureCurrent('flow', { draft: 0, flow: 0 }, afterRemoval)).toBe(false);
  expect(isCaptureCurrent('flow', { draft: 0, flow: 1 }, afterRemoval)).toBe(true);
});

it('keeps screens saved by hand or for comments and edits when the Flow is removed', () => {
  const afterRemoval = { draft: 0, flow: 1 };

  expect(isCaptureCurrent('manual', { draft: 0, flow: 0 }, afterRemoval)).toBe(true);
  expect(isCaptureCurrent('marks', { draft: 0, flow: 0 }, afterRemoval)).toBe(true);
});

it('drops every screen asked for before the draft was discarded', () => {
  const kept = SOURCES.filter((source) => isCaptureCurrent(source, { draft: 0, flow: 0 }, { draft: 1, flow: 0 }));

  expect(kept).toEqual([]);
});
