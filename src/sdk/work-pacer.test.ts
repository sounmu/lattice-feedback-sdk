import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkPacer } from '@/sdk/work-pacer';

const PAGE_RUNS_FOR_MS = 30;
let now: number;
let yields: number;

beforeEach(() => {
  now = 1_000;
  yields = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('scheduler', {
    yield: () => {
      yields += 1;
      now += PAGE_RUNS_FOR_MS;
      return Promise.resolve();
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps working while the slice lasts and lets the page run once it is used up', async () => {
  const pace = createWorkPacer();

  now += 7;
  await pace();
  expect(yields).toBe(0);

  now += 1;
  await pace();
  expect(yields).toBe(1);
});

it('starts a new slice after the page has run', async () => {
  const pace = createWorkPacer();
  now += 20;
  await pace();

  now += 7;
  await pace();
  expect(yields).toBe(1);

  now += 1;
  await pace();
  expect(yields).toBe(2);
});

it('gives up the task, not just the microtask, where the browser has no scheduler.yield', async () => {
  vi.stubGlobal('scheduler', undefined);
  const pace = createWorkPacer();
  now += 8;
  let isResumed = false;

  const paused = pace().then(() => {
    isResumed = true;
  });
  for (let tick = 0; tick < 50; tick += 1) await Promise.resolve();

  expect(isResumed).toBe(false);
  await paused;
  expect(isResumed).toBe(true);
});
