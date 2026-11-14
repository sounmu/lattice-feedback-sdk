import { expect, it } from 'vitest';
import {
  findAdjacentStep,
  findReplaySteps,
  getCurrentStepIndex,
  getViewportAt,
  keepListedCaptures,
} from '@/lib/screen-preview';
import type { ScreenSnapshotEvent } from '@/types/screen-snapshot';

const PAGE = { viewportWidth: 1440, viewportHeight: 900 };

function createMeta(timestamp: number, width: number, height: number): ScreenSnapshotEvent {
  return { type: 4, timestamp, data: { href: 'https://host.example.com/', width, height } };
}

function createFullSnapshot(timestamp: number): ScreenSnapshotEvent {
  return { type: 2, timestamp, data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { left: 0, top: 0 } } };
}

function createChange(timestamp: number, data: Record<string, unknown>): ScreenSnapshotEvent {
  return { type: 3, timestamp, data };
}

// A Flow that clicks, types, scrolls twice, moves to a narrower page, is resized and clicks again.
const REPLAY: ScreenSnapshotEvent[] = [
  createMeta(1000, 1440, 900),
  createFullSnapshot(1000),
  createChange(1100, { source: 1, positions: [] }),
  createChange(1200, { source: 2, type: 1, id: 5 }),
  createChange(1210, { source: 2, type: 2, id: 5 }),
  createChange(2000, { source: 5, id: 7, text: '*' }),
  createChange(2300, { source: 5, id: 7, text: '**' }),
  createChange(4000, { source: 3, id: 1, x: 0, y: 40 }),
  createChange(4400, { source: 3, id: 1, x: 0, y: 400 }),
  createChange(5000, { source: 3, id: 1, x: 0, y: 900 }),
  createMeta(6000, 390, 844),
  createFullSnapshot(6000),
  createChange(6500, { source: 4, width: 800, height: 600 }),
  createChange(7000, { source: 2, type: 2, id: 9 }),
];

it('steps through page changes, clicks and runs of typing or scrolling, skipping pointer noise', () => {
  expect(findReplaySteps(REPLAY)).toEqual([
    { kind: 'start', atMs: 0 },
    { kind: 'click', atMs: 999 },
    { kind: 'input', atMs: 2999 },
    { kind: 'scroll', atMs: 3999 },
    { kind: 'scroll', atMs: 4999 },
    { kind: 'screen', atMs: 5999 },
    { kind: 'click', atMs: 6000 },
  ]);
  expect(findReplaySteps([createMeta(1, 1440, 900), createFullSnapshot(1)])).toEqual([{ kind: 'start', atMs: 0 }]);
  expect(findReplaySteps([])).toEqual([{ kind: 'start', atMs: 0 }]);
});

it('moves to the neighbouring step from any position and stops at both ends', () => {
  const steps = findReplaySteps(REPLAY);
  const visited = [0];
  for (let step = findAdjacentStep(steps, 0, 'next'); step; step = findAdjacentStep(steps, step.atMs, 'next')) {
    visited.push(step.atMs);
  }

  expect(visited).toEqual(steps.map((step) => step.atMs));
  expect(getCurrentStepIndex(steps, 3500)).toBe(2);
  expect(findAdjacentStep(steps, 3500, 'previous')).toEqual({ kind: 'input', atMs: 2999 });
  expect(findAdjacentStep(steps, 2999, 'previous')).toEqual({ kind: 'click', atMs: 999 });
  expect(findAdjacentStep(steps, 3500, 'next')).toEqual({ kind: 'scroll', atMs: 3999 });
  expect(findAdjacentStep(steps, 0, 'previous')).toBeNull();
  expect(findAdjacentStep(steps, 6000, 'next')).toBeNull();
});

it('includes the DOM changes caused by a click before stopping at its step', () => {
  const events = [
    createMeta(1000, 1440, 900),
    createFullSnapshot(1000),
    createChange(1010, { source: 2, type: 2, id: 5 }),
    createChange(1074, { source: 0, texts: [{ id: 6, value: 'Saved' }] }),
  ];

  expect(findReplaySteps(events)).toEqual([
    { kind: 'start', atMs: 0 },
    { kind: 'click', atMs: 74 },
  ]);
});

it('follows the page size across a second Meta event and a window resize', () => {
  expect(getViewportAt(REPLAY, 0, PAGE)).toEqual({ viewportWidth: 1440, viewportHeight: 900 });
  expect(getViewportAt(REPLAY, 4999, PAGE)).toEqual({ viewportWidth: 1440, viewportHeight: 900 });
  expect(getViewportAt(REPLAY, 5001, PAGE)).toEqual({ viewportWidth: 390, viewportHeight: 844 });
  expect(getViewportAt(REPLAY, 5600, PAGE)).toEqual({ viewportWidth: 800, viewportHeight: 600 });
  expect(getViewportAt([createFullSnapshot(1)], 0, PAGE)).toEqual(PAGE);
});

it('lets go of the captures of screens that left the draft and keeps the rest untouched', () => {
  const first = { files: 1 };
  const third = { files: 3 };
  const captures = new Map([['a', first], ['b', { files: 2 }], ['c', third]]);

  const kept = keepListedCaptures(captures, [{ id: 'c' }, { id: 'a' }, { id: 'new' }]);

  expect([...kept.keys()]).toEqual(['a', 'c']);
  expect(kept.get('a')).toBe(first);
  expect(kept.get('c')).toBe(third);
  expect(keepListedCaptures(captures, []).size).toBe(0);
});
