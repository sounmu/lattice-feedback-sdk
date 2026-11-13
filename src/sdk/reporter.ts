import type { FeedbackReporter } from '@/types/feedback';

export function isFeedbackReporter(value: unknown): value is FeedbackReporter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'id' in value && typeof value.id === 'string' &&
    'name' in value && typeof value.name === 'string' &&
    (!('email' in value) || value.email === undefined || typeof value.email === 'string');
}

export function copyReporter(reporter: FeedbackReporter): FeedbackReporter {
  if (reporter.email === undefined) return { id: reporter.id, name: reporter.name };
  return { id: reporter.id, name: reporter.name, email: reporter.email };
}
