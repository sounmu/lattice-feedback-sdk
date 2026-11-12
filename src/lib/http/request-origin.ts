const DEVELOPMENT_APP_ORIGIN = 'http://localhost:3000';

// Public origins the widget is served from. The server never derives this from request.url:
// behind a reverse proxy or a renamed bind address that URL is the internal one.
export function getAppOrigins(): string[] {
  const origins = (process.env.FEEDBACK_APP_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length > 0) {
    return origins;
  }
  if (process.env.NODE_ENV !== 'production') {
    return [DEVELOPMENT_APP_ORIGIN];
  }
  return [];
}

// Only the widget iframe may submit. Sec-Fetch-Site is computed by the browser from the
// requesting document and the target URL, so it needs no knowledge of our public address.
// Older browsers without it fall back to Origin against the configured public origins.
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null) {
    return fetchSite === 'same-origin';
  }
  const origin = request.headers.get('origin');
  if (origin === null) {
    return false;
  }
  return getAppOrigins().includes(origin);
}
