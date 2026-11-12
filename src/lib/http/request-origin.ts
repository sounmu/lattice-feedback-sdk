// Only the widget iframe (served from this app's origin) may submit. Browsers set Origin and
// Sec-Fetch-Site themselves, so another site's page cannot pass this check.
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin !== null) {
    return origin === new URL(request.url).origin;
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
