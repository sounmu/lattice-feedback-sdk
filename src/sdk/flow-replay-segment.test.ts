import { expect, it } from 'vitest';
import { findGapBefore, mergeReplayChunks, mergeStashedChunks, parseStashedChunks } from '@/sdk/flow-replay-segment';
import type { ReplayChunk } from '@/sdk/flow-replay-session';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

const PAGE = { url: 'https://host.example.com/', title: 'Home', viewportWidth: 1440, viewportHeight: 900, scrollX: 0, scrollY: 0 };

function createEvent(type: number, timestamp: number): ScreenSnapshotEvent {
  return { type, timestamp, data: {} } as ScreenSnapshotEvent;
}

function createChunk(segment: number, index: number, events: ScreenSnapshotEvent[]): ReplayChunk {
  return { segment, index, page: PAGE, gapBefore: false, ended: false, events, bytes: events.length * 10, usedCssImageUrls: [], loadedFontFamilies: [], liveImageSources: [] };
}

const snapshotChunk = createChunk(0, 0, [createEvent(4, 1), createEvent(2, 1)]);
const clickChunk = createChunk(0, 1, [createEvent(3, 2)]);
const PROGRESS_AFTER_CLICK = { segment: 0, eventCount: 3 };

it('marks a gap when the last click never reached the saved chunks', () => {
  const saved = mergeReplayChunks(mergeStashedChunks([snapshotChunk], []));

  expect(findGapBefore(saved, PROGRESS_AFTER_CLICK)).toBe(true);
});

it('has no gap once the stashed click is merged in', () => {
  const saved = mergeReplayChunks(mergeStashedChunks([snapshotChunk], [clickChunk]));

  expect(saved.lastEventCount).toBe(3);
  expect(findGapBefore(saved, PROGRESS_AFTER_CLICK)).toBe(false);
});

it('keeps a chunk that is both saved and stashed once', () => {
  const merged = mergeStashedChunks([snapshotChunk, clickChunk], [clickChunk]);

  expect(merged.map((chunk) => `${chunk.segment}:${chunk.index}`)).toEqual(['0:0', '0:1']);
  expect(findGapBefore(mergeReplayChunks(merged), PROGRESS_AFTER_CLICK)).toBe(false);
});

it('orders stashed chunks after the saved ones of the same document', () => {
  const merged = mergeStashedChunks([createChunk(1, 0, [createEvent(4, 5), createEvent(2, 5)]), snapshotChunk], [clickChunk]);

  expect(merged.map((chunk) => `${chunk.segment}:${chunk.index}`)).toEqual(['0:0', '0:1', '1:0']);
});

it('still marks a gap when more was recorded than saved and stashed together', () => {
  const saved = mergeReplayChunks(mergeStashedChunks([snapshotChunk], [clickChunk]));

  expect(findGapBefore(saved, { segment: 0, eventCount: 4 })).toBe(true);
});

it('still marks a gap when the note comes from another document or is missing', () => {
  const saved = mergeReplayChunks(mergeStashedChunks([snapshotChunk], [clickChunk]));

  expect(findGapBefore(saved, { segment: 1, eventCount: 3 })).toBe(true);
  expect(findGapBefore(saved, null)).toBe(true);
});

it('reads back the chunks it was given and nothing else', () => {
  expect(parseStashedChunks(JSON.stringify([clickChunk]))).toEqual([clickChunk]);
  expect(parseStashedChunks(null)).toEqual([]);
  expect(parseStashedChunks('not json')).toEqual([]);
  expect(parseStashedChunks('{"segment":0}')).toEqual([]);
  expect(parseStashedChunks(JSON.stringify([{ segment: 0, index: 1 }]))).toEqual([]);
});
