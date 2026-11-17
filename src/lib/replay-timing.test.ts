import { afterEach, expect, it } from 'vitest';
import { createReplayTiming } from '@/lib/replay-timing';

afterEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

it('measures a load from its own marks when another load marks the same steps', () => {
  const viewed = createReplayTiming();
  const other = createReplayTiming();

  viewed.mark('snapshot-start');
  const [viewedStart] = performance.getEntriesByType('mark');
  other.mark('snapshot-start');
  other.mark('replayer-created');
  viewed.mark('replayer-created');
  viewed.mark('first-rebuilt');

  const [firstDisplay] = performance.getEntriesByName('lattice-replay:first-display', 'measure');
  expect(firstDisplay.startTime).toBe(viewedStart.startTime);
  expect(performance.getEntriesByName('lattice-replay:first-rebuild', 'measure')).toHaveLength(1);
});

it('leaves no measure for a load that never rebuilt its first page', () => {
  const abandoned = createReplayTiming();

  abandoned.mark('snapshot-start');
  abandoned.mark('replayer-created');

  expect(performance.getEntriesByType('measure')).toHaveLength(0);
});
