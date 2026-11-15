import { expect, it } from 'vitest';
import { findGapBefore, findUnsavedChunks, mergeReplayChunks, mergeStashedChunks, parseStashedChunks } from '@/sdk/flow-replay-segment';
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
const PROGRESS_AFTER_CLICK = { segment: 0, eventCount: 3, totalEventCount: 3 };

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

  expect(findGapBefore(saved, { segment: 0, eventCount: 4, totalEventCount: 4 })).toBe(true);
});

it('still marks a gap when the note comes from another document or is missing', () => {
  const saved = mergeReplayChunks(mergeStashedChunks([snapshotChunk], [clickChunk]));

  expect(findGapBefore(saved, { segment: 1, eventCount: 3, totalEventCount: 3 })).toBe(true);
  expect(findGapBefore(saved, null)).toBe(true);
});

// Page A saved its snapshot but its click chunk was still being written when A was left, so only the stash
// held it. Page B is left right after loading, and page C reads what IndexedDB holds.
const pageBChunk = createChunk(1, 0, [createEvent(4, 5), createEvent(2, 5), createEvent(3, 6)]);
// B knew the three events of A and its own three when it was left.
const PROGRESS_AFTER_B = { segment: 1, eventCount: 3, totalEventCount: 6 };

it('finds the stashed chunks IndexedDB lacks, and none once it holds them', () => {
  expect(findUnsavedChunks([snapshotChunk], [clickChunk])).toEqual([clickChunk]);
  expect(findUnsavedChunks([snapshotChunk, clickChunk], [clickChunk])).toEqual([]);
  expect(findUnsavedChunks([snapshotChunk], [])).toEqual([]);
});

it('keeps the click of page A for page C once page B saved it again', () => {
  const stored = [snapshotChunk];
  const recovered = findUnsavedChunks(stored, [clickChunk]);
  const storedAfterB = [...stored, ...recovered, pageBChunk];
  const saved = mergeReplayChunks(mergeStashedChunks(storedAfterB, []));

  expect(saved.segments[0].events).toHaveLength(3);
  expect(findGapBefore(saved, PROGRESS_AFTER_B)).toBe(false);
});

it('marks a gap for page C when the click of page A was lost on the way through page B', () => {
  const saved = mergeReplayChunks(mergeStashedChunks([snapshotChunk, pageBChunk], []));

  expect(saved.segments[0].events).toHaveLength(2);
  expect(findGapBefore(saved, PROGRESS_AFTER_B)).toBe(true);
});

it('marks a gap when the note does not say how much the whole Flow had', () => {
  const saved = mergeReplayChunks([snapshotChunk, clickChunk, pageBChunk]);

  expect(findGapBefore(saved, { segment: 1, eventCount: 3, totalEventCount: Number.NaN })).toBe(true);
  expect(findGapBefore(saved, PROGRESS_AFTER_B)).toBe(false);
});

it('reads back the chunks it was given and nothing else', () => {
  expect(parseStashedChunks(JSON.stringify([clickChunk]))).toEqual([clickChunk]);
  expect(parseStashedChunks(null)).toEqual([]);
  expect(parseStashedChunks('not json')).toEqual([]);
  expect(parseStashedChunks('{"segment":0}')).toEqual([]);
  expect(parseStashedChunks(JSON.stringify([{ segment: 0, index: 1 }]))).toEqual([]);
});
