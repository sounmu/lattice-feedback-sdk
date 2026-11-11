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

export function createJsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
