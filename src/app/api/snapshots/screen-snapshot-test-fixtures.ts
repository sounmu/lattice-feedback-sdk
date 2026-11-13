import { ALLOWED_ORIGIN } from '@/app/api/feedback/feedback-test-fixtures';

export function createScreenSnapshotBody(overrides: Record<string, unknown> = {}) {
  return {
    projectKey: 'demo',
    hostOrigin: ALLOWED_ORIGIN,
    format: 'rrweb-2',
    capturedAt: '2026-11-13T03:00:00.000Z',
    page: {
      url: `${ALLOWED_ORIGIN}/orders`,
      title: 'Orders',
      viewportWidth: 1440,
      viewportHeight: 900,
      scrollX: 0,
      scrollY: 120,
    },
    events: [
      { type: 4, timestamp: 1, data: { href: `${ALLOWED_ORIGIN}/orders`, width: 1440, height: 900 } },
      { type: 2, timestamp: 1, data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { left: 0, top: 120 } } },
    ],
    missingAssets: [],
    ...overrides,
  };
}
