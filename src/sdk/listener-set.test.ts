import { expect, it, vi } from 'vitest';
import { createListenerSet } from '@/sdk/listener-set';

it('tells every listener each time it is notified, and none after it was removed', () => {
  const set = createListenerSet();
  const first = vi.fn();
  const second = vi.fn();
  const removeFirst = set.add(first);
  set.add(second);

  set.notify();
  removeFirst();
  set.notify();

  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
});

it('lets a listener remove itself while it is being told, and keeps telling the others when one fails', () => {
  const set = createListenerSet();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const after = vi.fn();
  const removeSelf = set.add(() => removeSelf());
  set.add(() => { throw new Error('broken'); });
  set.add(after);

  set.notify();
  set.notify();

  expect(after).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});
