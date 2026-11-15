import { describe, expect, it } from 'vitest';
import {
  createHostToWidgetMessage,
  createPreviewMessage,
  createWidgetToHostMessage,
  isHostToWidgetMessage,
  isPreviewConnectMessage,
  isPreviewContentMessage,
  isPreviewToHostMessage,
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
  it('rejects a malformed reporter organization', () => {
    const reporter = { id: 'alice', name: 'Alice', organization: { id: 5 } };
    expect(isHostToWidgetMessage(createHostToWidgetMessage('reporter:update', { reporter } as never))).toBe(false);
  });

  it('accepts boolean visibility only and rejects malformed identity proofs', () => {
    const visible = createHostToWidgetMessage('visibility:update', { isOpen: true });
    expect(isHostToWidgetMessage(visible)).toBe(true);
    expect(isHostToWidgetMessage({ ...visible, payload: { isOpen: 'true' } })).toBe(false);
    expect(isHostToWidgetMessage({
      ...INIT_MESSAGE, payload: { ...INIT_MESSAGE.payload, reporter: { id: 'alice', name: 'Alice', identity: { signature: 'bad' } } },
    })).toBe(false);
  });
  it('accepts built messages of every type', () => {
    expect(isHostToWidgetMessage(INIT_MESSAGE)).toBe(true);
    expect(isHostToWidgetMessage(createHostToWidgetMessage('screen:captured', { requestId: 'request-1', screen: SCREEN, assetFiles: [] }))).toBe(true);
    expect(
      isHostToWidgetMessage(createHostToWidgetMessage('screen:capture-failed', { requestId: 'request-1', reason: 'page_not_allowed' })),
    ).toBe(true);
    expect(isHostToWidgetMessage(createHostToWidgetMessage('reporter:update', { reporter: null }))).toBe(true);
    expect(isHostToWidgetMessage(createHostToWidgetMessage('page:update', { page: PAGE }))).toBe(true);
    expect(isHostToWidgetMessage(createHostToWidgetMessage('preview:closed', { previewId: 'preview-1' }))).toBe(true);
  });

  it('rejects a closed preview without a usable id', () => {
    const closed = createHostToWidgetMessage('preview:closed', { previewId: 'preview-1' });
    expect(isHostToWidgetMessage({ ...closed, payload: {} })).toBe(false);
    expect(isHostToWidgetMessage({ ...closed, payload: { previewId: 'p'.repeat(65) } })).toBe(false);
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
    const captured = createHostToWidgetMessage('screen:captured', { requestId: 'request-1', screen: SCREEN, assetFiles: [] });
    const withScreen = (screen: unknown) => ({ ...captured, payload: { requestId: 'request-1', screen, assetFiles: [] } });

    expect(isHostToWidgetMessage(withScreen({ ...SCREEN, events: [...SCREEN.events].reverse() }))).toBe(false);
    expect(isHostToWidgetMessage(withScreen({ ...SCREEN, events: [SCREEN.events[1]] }))).toBe(false);
    expect(isHostToWidgetMessage(withScreen({ ...SCREEN, format: 'html' }))).toBe(false);
    expect(isHostToWidgetMessage({ ...captured, payload: { screen: SCREEN, assetFiles: ['font-bytes'] } })).toBe(false);
    expect(isHostToWidgetMessage({ ...captured, payload: { screen: SCREEN } })).toBe(false);
    expect(isHostToWidgetMessage({ ...captured, payload: { screen: SCREEN, assetFiles: [] } })).toBe(false);
    expect(isHostToWidgetMessage(withScreen({ ...SCREEN, page: { ...SCREEN.page, scrollY: '40' } }))).toBe(false);
    expect(
      isHostToWidgetMessage({ ...captured, type: 'screen:capture-failed', payload: { requestId: 'request-1', reason: 'out_of_memory' } }),
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
    expect(isWidgetToHostMessage(createWidgetToHostMessage('screen:capture', { requestId: 'request-1' }))).toBe(true);
    expect(isWidgetToHostMessage(createWidgetToHostMessage('flow:capture', { requestId: 'request-2' }))).toBe(true);
    expect(isWidgetToHostMessage(createWidgetToHostMessage('preview:open', { previewId: 'preview-1' }))).toBe(true);
    expect(isWidgetToHostMessage(createWidgetToHostMessage('preview:close', {}))).toBe(true);
    expect(isWidgetToHostMessage(SUBMITTED_MESSAGE)).toBe(true);
  });

  it('rejects a preview request without a usable id', () => {
    const open = createWidgetToHostMessage('preview:open', { previewId: 'preview-1' });
    expect(isWidgetToHostMessage({ ...open, payload: {} })).toBe(false);
    expect(isWidgetToHostMessage({ ...open, payload: { previewId: '' } })).toBe(false);
    expect(isWidgetToHostMessage({ ...open, payload: { previewId: 7 } })).toBe(false);
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

describe('preview iframe messages', () => {
  const CONTENT = createPreviewMessage('preview:content', {
    title: '저장한 화면 1 미리보기',
    subtitle: '1280×720',
    capture: { screen: SCREEN, assetFiles: [new Blob(['font-bytes'])] },
  });
  const withPayload = (payload: object) => ({ ...CONTENT, payload: { ...CONTENT.payload, ...payload } });

  it('keeps the preview iframe to its own two requests', () => {
    expect(isPreviewToHostMessage(createPreviewMessage('preview:ready', {}))).toBe(true);
    expect(isPreviewToHostMessage(createPreviewMessage('preview:close', {}))).toBe(true);
    expect(isPreviewToHostMessage(createWidgetToHostMessage('ready', {}))).toBe(false);
    expect(isPreviewToHostMessage(createWidgetToHostMessage('screen:capture', { requestId: 'request-1' }))).toBe(false);
    expect(isPreviewToHostMessage(createPreviewMessage('preview:connect', {}))).toBe(false);
  });

  it('accepts only the connect message from the SDK', () => {
    const connect = createPreviewMessage('preview:connect', {});
    expect(isPreviewConnectMessage(connect)).toBe(true);
    expect(isPreviewConnectMessage({ ...connect, source: 'other-sdk' })).toBe(false);
    expect(isPreviewConnectMessage(INIT_MESSAGE)).toBe(false);
  });

  it('accepts a screen with its files as preview content', () => {
    expect(isPreviewContentMessage(CONTENT)).toBe(true);
    expect(isPreviewContentMessage(withPayload({ subtitle: '' }))).toBe(true);
  });

  it('rejects preview content that is unnamed, oversized or not a saved screen', () => {
    expect(isPreviewContentMessage(withPayload({ title: '' }))).toBe(false);
    expect(isPreviewContentMessage(withPayload({ title: '가'.repeat(201) }))).toBe(false);
    expect(isPreviewContentMessage(withPayload({ subtitle: 7 }))).toBe(false);
    expect(isPreviewContentMessage(withPayload({ capture: null }))).toBe(false);
    expect(isPreviewContentMessage(withPayload({ capture: { screen: SCREEN, assetFiles: ['font-bytes'] } }))).toBe(false);
    expect(isPreviewContentMessage(withPayload({ capture: { screen: SCREEN, assetFiles: Array.from({ length: 41 }, () => new Blob()) } }))).toBe(false);
    expect(isPreviewContentMessage(withPayload({
      capture: { screen: { ...SCREEN, events: [...SCREEN.events].reverse() }, assetFiles: [] },
    }))).toBe(false);
    expect(isPreviewContentMessage({ ...CONTENT, type: 'preview:connect' })).toBe(false);
  });
});
