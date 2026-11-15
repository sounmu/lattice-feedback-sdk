import { expect, it } from 'vitest';
import { createPendingStartGate } from '@/sdk/pending-start';

it('lets a start that nothing interrupted go ahead', () => {
  const gate = createPendingStartGate();
  const isCurrent = gate.begin();
  expect(isCurrent()).toBe(true);
});

it('drops a start waiting for the index once the widget is closed, cancelled or reset', () => {
  const gate = createPendingStartGate();
  const isCurrent = gate.begin();
  gate.invalidate();
  expect(isCurrent()).toBe(false);
});

it('lets only the newest of several waiting starts run, and later starts again after an invalidation', () => {
  const gate = createPendingStartGate();
  const first = gate.begin();
  const second = gate.begin();
  expect([first(), second()]).toEqual([false, true]);
  gate.invalidate();
  expect(gate.begin()()).toBe(true);
});
