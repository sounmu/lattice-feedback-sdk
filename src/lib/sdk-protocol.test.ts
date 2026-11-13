import { describe, expect, it } from 'vitest';
import {
  createHostToWidgetMessage,
  createWidgetToHostMessage,
  isHostToWidgetMessage,
  isWidgetToHostMessage,
} from '@/lib/sdk-protocol';
import { MESSAGE_SOURCE, PROTOCOL_VERSION } from '@/types/sdk-message';
import type { PageContext } from '@/types/feedback';
import type { CapturedScreen } from '@/types/screen-snapshot';

const PAGE: PageContext = {
  url: 'https://host.example.com/orders',
  title: 'Orders',
  viewportWidth: 1280,
  viewportHeight: 720,
  userAgent: 'test-agent',
};

const INIT_MESSAGE = createHostToWidgetMessage('init', {
  projectKey: 'demo',
  reporter: { id: 'user_1', name: 'Tester' },
  page: PAGE,
});

const SCREEN: CapturedScreen = {
  format: 'rrweb-2',
  capturedAt: '2026-11-13T03:00:00.000Z',
  page: { url: PAGE.url, title: PAGE.title, viewportWidth: 1280, viewportHeight: 720, scrollX: 0, scrollY: 40 },
  events: [
    { type: 4, timestamp: 1, data: { href: PAGE.url, width: 1280, height: 720 } },
    { type: 2, timestamp: 1, data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { left: 0, top: 40 } } },
  ],
  missingAssets: [{ url: 'https://host.example.com/font.woff2', reason: 'too_large' }],
};

describe('isHostToWidgetMessage', () => {
  it('accepts built messages of every type', () => {
    expect(isHostToWidgetMessage(INIT_MESSAGE)).toBe(true);
    expect(isHostToWidgetMessage(createHostToWidgetMessage('screen:captured', { screen: SCREEN, assetFiles: [] }))).toBe(true);
    expect(
      isHostToWidgetMessage(createHostToWidgetMessage('screen:capture-failed', { reason: 'page_not_allowed' })),
    ).toBe(true);
    expect(isHostToWidgetMessage(createHostToWidgetMessage('reporter:update', { reporter: null }))).toBe(true);
    expect(isHostToWidgetMessage(createHostToWidgetMessage('page:update', { page: PAGE }))).toBe(true);
  });

  it('rejects a wrong source', () => {
    expect(isHostToWidgetMessage({ ...INIT_MESSAGE, source: 'other-sdk' })).toBe(false);
  });

  it('rejects a wrong version', () => {
    expect(isHostToWidgetMessage({ ...INIT_MESSAGE, version: PROTOCOL_VERSION + 1 })).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(isHostToWidgetMessage({ ...INIT_MESSAGE, type: 'eval' })).toBe(false);
  });

  it('rejects a widget-to-host type', () => {
    expect(isHostToWidgetMessage(createWidgetToHostMessage('ready', {}))).toBe(false);
  });

  it('rejects wrong payload field types', () => {
    expect(isHostToWidgetMessage({ ...INIT_MESSAGE, payload: { ...INIT_MESSAGE.payload, projectKey: 42 } })).toBe(false);
    expect(
      isHostToWidgetMessage({ ...INIT_MESSAGE, payload: { ...INIT_MESSAGE.payload, page: { ...PAGE, viewportWidth: '1280' } } }),
    ).toBe(false);
    expect(
      isHostToWidgetMessage({ ...INIT_MESSAGE, payload: { ...INIT_MESSAGE.payload, reporter: { id: 'user_1' } } }),
    ).toBe(false);
  });

  it('rejects a saved screen that is not one Meta event followed by one FullSnapshot event', () => {
    const captured = createHostToWidgetMessage('screen:captured', { screen: SCREEN, assetFiles: [] });
    const withScreen = (screen: unknown) => ({ ...captured, payload: { screen, assetFiles: [] } });

    expect(isHostToWidgetMessage(withScreen({ ...SCREEN, events: [...SCREEN.events].reverse() }))).toBe(false);
    expect(isHostToWidgetMessage(withScreen({ ...SCREEN, events: [SCREEN.events[1]] }))).toBe(false);
    expect(isHostToWidgetMessage(withScreen({ ...SCREEN, format: 'html' }))).toBe(false);
    expect(isHostToWidgetMessage({ ...captured, payload: { screen: SCREEN, assetFiles: ['font-bytes'] } })).toBe(false);
    expect(isHostToWidgetMessage({ ...captured, payload: { screen: SCREEN } })).toBe(false);
    expect(isHostToWidgetMessage(withScreen({ ...SCREEN, page: { ...SCREEN.page, scrollY: '40' } }))).toBe(false);
    expect(
      isHostToWidgetMessage({ ...captured, type: 'screen:capture-failed', payload: { reason: 'out_of_memory' } }),
    ).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(isHostToWidgetMessage(null)).toBe(false);
    expect(isHostToWidgetMessage('init')).toBe(false);
    expect(isHostToWidgetMessage({ source: MESSAGE_SOURCE, version: PROTOCOL_VERSION, type: 'init' })).toBe(false);
  });
});

describe('isWidgetToHostMessage', () => {
  const SUBMITTED_MESSAGE = createWidgetToHostMessage('submitted', { feedbackId: 'fb_1' });

  it('accepts built messages of every type', () => {
    expect(isWidgetToHostMessage(createWidgetToHostMessage('ready', {}))).toBe(true);
    expect(isWidgetToHostMessage(createWidgetToHostMessage('close', {}))).toBe(true);
    expect(isWidgetToHostMessage(createWidgetToHostMessage('screen:capture', {}))).toBe(true);
    expect(isWidgetToHostMessage(SUBMITTED_MESSAGE)).toBe(true);
  });

  it('rejects a wrong source', () => {
    expect(isWidgetToHostMessage({ ...SUBMITTED_MESSAGE, source: 'other-sdk' })).toBe(false);
  });

  it('rejects a wrong version', () => {
    expect(isWidgetToHostMessage({ ...SUBMITTED_MESSAGE, version: 0 })).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(isWidgetToHostMessage({ ...SUBMITTED_MESSAGE, type: 'navigate' })).toBe(false);
  });

  it('rejects a host-to-widget type', () => {
    expect(isWidgetToHostMessage(INIT_MESSAGE)).toBe(false);
  });

  it('rejects wrong payload field types', () => {
    expect(isWidgetToHostMessage({ ...SUBMITTED_MESSAGE, payload: { feedbackId: 1 } })).toBe(false);
    expect(isWidgetToHostMessage({ ...SUBMITTED_MESSAGE, payload: {} })).toBe(false);
    expect(isWidgetToHostMessage({ ...SUBMITTED_MESSAGE, payload: 'fb_1' })).toBe(false);
  });
});
