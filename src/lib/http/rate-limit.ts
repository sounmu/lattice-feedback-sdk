const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_TRACKED_CLIENTS = 10_000;

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

function pruneExpiredBuckets(buckets: Map<string, RateLimitBucket>, now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

export function resetRateLimit(): void {
  getBuckets().clear();
}

export function getClientAddress(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function consumeRateLimit(key: string, now: number = Date.now()): boolean {
  const buckets = getBuckets();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    if (buckets.size >= MAX_TRACKED_CLIENTS) {
      pruneExpiredBuckets(buckets, now);
    }
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  bucket.count += 1;
  return true;
}

export const RATE_LIMIT_RETRY_AFTER_SECONDS = RATE_LIMIT_WINDOW_MS / 1000;
export const RATE_LIMIT_MAX_REQUESTS = MAX_REQUESTS_PER_WINDOW;
