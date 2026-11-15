import type { FeedbackReporter } from '@/types/feedback';

export function isFeedbackReporter(value: unknown): value is FeedbackReporter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'id' in value && typeof value.id === 'string' &&
    'name' in value && typeof value.name === 'string' &&
    (!('identity' in value) || value.identity === undefined || isReporterIdentity(value.identity)) &&
    (!('email' in value) || value.email === undefined || typeof value.email === 'string');
}

export function copyReporter(reporter: FeedbackReporter): FeedbackReporter {
  return {
    id: reporter.id, name: reporter.name,
    ...(reporter.email === undefined ? {} : { email: reporter.email }),
    ...(reporter.identity === undefined ? {} : { identity: { ...reporter.identity } }),
  };
}

export function isReporterIdentity(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    'expiresAt' in value && typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt) &&
    'signature' in value && typeof value.signature === 'string' && /^[a-f0-9]{64}$/.test(value.signature);
}
