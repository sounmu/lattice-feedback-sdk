import { afterEach, expect, it, vi } from 'vitest';
import { createFlowRecorder, type FlowRecorderState } from '@/sdk/flow-recorder';
import { createFlowSession, getFlowSessionKey } from '@/sdk/flow-session';
import { MemoryStorage } from '@/sdk/flow-test-fixtures';
import type { FlowAttachment } from '@/types/feedback';

afterEach(() => vi.unstubAllGlobals());

it('restores a recording started in another document when an idle page returns from bfcache', () => {
  const storage = new MemoryStorage();
  const host = Object.assign(new EventTarget(), { sessionStorage: storage, location: { pathname: '/contracts' } });
  vi.stubGlobal('window', host);
  const states: FlowRecorderState[] = [];
  const attachments: FlowAttachment[] = [];
  const recorder = createFlowRecorder({
    projectKey: 'bfcache-idle-case',
    isPageAllowed: () => true,
    isPathAllowed: (path) => path === '/contracts',
    isTargetAllowed: () => false,
    findTarget: () => null,
    onComplete: (attachment) => attachments.push(attachment),
    onStateChange: (state) => states.push(state),
  });
  expect(states.at(-1)?.recording).toBe(false);
  storage.setItem(getFlowSessionKey('bfcache-idle-case'), JSON.stringify(createFlowSession(Date.now(), false)));
  const restored = new Event('pageshow');
  Object.defineProperty(restored, 'persisted', { value: true });

  host.dispatchEvent(restored);

  expect(states.at(-1)).toMatchObject({ recording: true, eventCount: 1 });
  recorder.stop();
  expect(attachments[0].events[0]).toMatchObject({ type: 'navigation', path: '/contracts', navigationType: 'document' });
  expect(storage.length).toBe(0);
  recorder.destroy();
});
