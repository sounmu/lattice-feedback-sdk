export const ADMIN_AUTHORIZATION = 'Bearer dev-admin-token';
export const ALLOWED_ORIGIN = 'http://localhost:4000';

export function createFeedbackBody(overrides: Record<string, unknown> = {}) {
  return {
    projectKey: 'demo',
    hostOrigin: ALLOWED_ORIGIN,
    message: 'The save button is hidden on mobile.',
    type: 'bug',
    reporter: { id: 'user-1', name: 'Demo User' },
    page: {
      url: `${ALLOWED_ORIGIN}/orders`,
      title: 'Orders',
      viewportWidth: 390,
      viewportHeight: 844,
      userAgent: 'vitest',
    },
    ...overrides,
  };
}

// Same-origin by default, as sent by the widget iframe.
export function createJsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', origin: new URL(url).origin, ...headers },
    body: JSON.stringify(body),
  });
}
