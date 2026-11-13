import { afterEach, expect, it, vi } from 'vitest';
import { trackHistory } from '@/sdk/history-tracking';

afterEach(() => vi.unstubAllGlobals());

it('preserves host history calls and reports each real navigation until cleanup', () => {
  const pushState = vi.fn();
  const replaceState = vi.fn();
  const host = Object.assign(new EventTarget(), { history: { pushState, replaceState } });
  vi.stubGlobal('window', host);
  const changed = vi.fn();
  const stop = trackHistory(changed);

  window.history.pushState({ id: 1 }, '', '/next');
  window.history.replaceState(null, '', '/other');
  host.dispatchEvent(new Event('popstate'));

  expect(pushState).toHaveBeenCalledWith({ id: 1 }, '', '/next');
  expect(replaceState).toHaveBeenCalledWith(null, '', '/other');
  expect(changed).toHaveBeenCalledTimes(3);
  stop();
  stop();
  host.dispatchEvent(new Event('popstate'));
  expect(changed).toHaveBeenCalledTimes(3);
  expect(window.history.pushState).toBe(pushState);
  expect(window.history.replaceState).toBe(replaceState);
});

it('does not overwrite a history wrapper installed later by the host', () => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { history: { pushState: vi.fn(), replaceState: vi.fn() } }));
  const stop = trackHistory(vi.fn());
  const laterWrapper = vi.fn();
  window.history.pushState = laterWrapper;

  stop();

  expect(window.history.pushState).toBe(laterWrapper);
});
