import type { FeedbackReporter, ReporterOrganization } from '@/types/feedback';

export function isFeedbackReporter(value: unknown): value is FeedbackReporter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'id' in value && typeof value.id === 'string' &&
    'name' in value && typeof value.name === 'string' &&
    (!('organization' in value) || value.organization === undefined || isReporterOrganization(value.organization)) &&
    (!('identity' in value) || value.identity === undefined || isReporterIdentity(value.identity)) &&
    (!('email' in value) || value.email === undefined || typeof value.email === 'string');
}

export function copyReporter(reporter: FeedbackReporter): FeedbackReporter {
  return {
    id: reporter.id, name: reporter.name,
    ...(reporter.email === undefined ? {} : { email: reporter.email }),
    ...(reporter.organization === undefined ? {} : { organization: copyOrganization(reporter.organization) }),
    ...(reporter.identity === undefined ? {} : { identity: { ...reporter.identity } }),
  };
}

function copyOrganization(organization: ReporterOrganization): ReporterOrganization {
  return { id: organization.id, ...(organization.name === undefined ? {} : { name: organization.name }) };
}

export function isReporterOrganization(value: unknown): value is ReporterOrganization {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'id' in value && typeof value.id === 'string' && value.id.length > 0 &&
    (!('name' in value) || value.name === undefined || typeof value.name === 'string');
}

export function isReporterIdentity(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    'expiresAt' in value && typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt) &&
    'signature' in value && typeof value.signature === 'string' && /^[a-f0-9]{64}$/.test(value.signature);
}
