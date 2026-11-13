const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_TRACKED_CLIENTS = 10_000;
const UNKNOWN_CLIENT_ADDRESS = 'unknown';
const VERCEL_CLIENT_IP_HEADER = 'x-vercel-forwarded-for';

interface RateLimitBucket {
  windowStart: number;
  count: number;
}

// Kept on globalThis so the buckets survive dev hot reload, like the memory store.
const globalForRateLimit = globalThis as typeof globalThis & {
  feedbackRateLimitBuckets?: Map<string, RateLimitBucket>;
};

function getBuckets(): Map<string, RateLimitBucket> {
  if (!globalForRateLimit.feedbackRateLimitBuckets) {
    globalForRateLimit.feedbackRateLimitBuckets = new Map();
  }
  return globalForRateLimit.feedbackRateLimitBuckets;
}

export function resetRateLimit(): void {
  getBuckets().clear();
}

export function getTrackedClientCount(): number {
  return getBuckets().size;
}

// Only a header that our own proxy sets (and overwrites) can identify the client; anything else
// is client-controlled. Without one, all clients share a single bucket.
function findTrustedClientIpHeader(): string | null {
  const configuredHeader = process.env.FEEDBACK_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (configuredHeader) {
    return configuredHeader;
  }
  if (process.env.VERCEL === '1') {
    return VERCEL_CLIENT_IP_HEADER;
  }
  return null;
}

export function getClientAddress(request: Request): string {
  const header = findTrustedClientIpHeader();
  if (header === null) {
    return UNKNOWN_CLIENT_ADDRESS;
  }
  const value = request.headers.get(header)?.split(',')[0].trim();
  if (!value) {
    return UNKNOWN_CLIENT_ADDRESS;
  }
  return value;
}

export function consumeRateLimit(
  key: string,
  now: number = Date.now(),
  maxRequests: number = MAX_REQUESTS_PER_WINDOW,
): boolean {
  const buckets = getBuckets();
  const bucket = buckets.get(key);
  // Map keeps insertion order: deleting and re-inserting moves the key to the newest end,
  // so the first key is always the least recently used one.
  buckets.delete(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    if (buckets.size >= MAX_TRACKED_CLIENTS) {
      const leastRecentlyUsedKey = buckets.keys().next().value;
      if (leastRecentlyUsedKey !== undefined) {
        buckets.delete(leastRecentlyUsedKey);
      }
    }
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  buckets.set(key, bucket);
  if (bucket.count >= maxRequests) {
    return false;
  }
  bucket.count += 1;
  return true;
}

export const RATE_LIMIT_RETRY_AFTER_SECONDS = RATE_LIMIT_WINDOW_MS / 1000;
export const RATE_LIMIT_MAX_REQUESTS = MAX_REQUESTS_PER_WINDOW;
export const RATE_LIMIT_MAX_TRACKED_CLIENTS = MAX_TRACKED_CLIENTS;
