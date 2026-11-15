import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createConversationSecret, findVerifiedReporterIdentity, hashConversationSecret } from '@/lib/reporter-identity';
import type { Project } from '@/lib/projects';

const project: Project = { projectKey: 'demo', name: 'Demo', allowedOrigins: [], adminToken: null, capturePolicy: null, identitySecret: 'customer-server-test-secret' };
const now = 1_800_000_000_000;
const expiresAt = now / 1000 + 3600;

// Independent customer-side signing examples; the implementation under test only verifies.
function sign(payload: unknown[]): string {
  return createHmac('sha256', 'customer-server-test-secret').update(JSON.stringify(payload)).digest('hex');
}
const signatureV1 = sign(['lattice-identity-v1', 'demo', 'alice', expiresAt]);
const signatureV2 = sign(['lattice-identity-v2', 'demo', 'alice', 'acme', expiresAt]);
const signatureV2WithoutOrganization = sign(['lattice-identity-v2', 'demo', 'alice', null, expiresAt]);
const reporter = { id: 'alice', name: 'Alice', identity: { expiresAt, signature: signatureV1 } };
const organization = { id: 'acme', name: 'Acme Corp' };

describe('verified reporter identity (v1)', () => {
  it('accepts the customer server signature and binds it to project, id and expiry', () => {
    expect(findVerifiedReporterIdentity(project, reporter, now)).toEqual({ reporterId: 'alice', organizationId: null });
    expect(findVerifiedReporterIdentity(project, { ...reporter, id: 'bob' }, now)).toBeNull();
    expect(findVerifiedReporterIdentity({ ...project, projectKey: 'other' }, reporter, now)).toBeNull();
    expect(findVerifiedReporterIdentity(project, reporter, expiresAt * 1000)).toBeNull();
    expect(findVerifiedReporterIdentity(project, reporter, now - 86_400_000)).toBeNull();
  });

  it('still verifies the reporter with a v1 signature but never verifies a claimed organization', () => {
    expect(findVerifiedReporterIdentity(project, { ...reporter, organization }, now))
      .toEqual({ reporterId: 'alice', organizationId: null });
  });

  it.each([undefined, { expiresAt, signature: '0'.repeat(64) }, { expiresAt, signature: 'bad' }])(
    'treats missing or invalid proof as unverified', (identity) => {
      expect(findVerifiedReporterIdentity(project, { id: 'alice', name: 'Alice', identity }, now)).toBeNull();
    },
  );

  it('never enables verified history without an explicitly configured secret', () => {
    expect(findVerifiedReporterIdentity({ ...project, identitySecret: null }, reporter, now)).toBeNull();
  });
});

describe('verified reporter organization (v2)', () => {
  const signedReporter = { id: 'alice', name: 'Alice', organization, identity: { expiresAt, signature: signatureV2 } };

  it('returns the organization id the signature covers', () => {
    expect(findVerifiedReporterIdentity(project, signedReporter, now)).toEqual({ reporterId: 'alice', organizationId: 'acme' });
  });

  it('rejects the whole proof when the organization id was tampered with', () => {
    expect(findVerifiedReporterIdentity(project, { ...signedReporter, organization: { id: 'rival' } }, now)).toBeNull();
  });

  it('does not sign the display name, only the id', () => {
    expect(findVerifiedReporterIdentity(project, { ...signedReporter, organization: { id: 'acme', name: 'Renamed' } }, now))
      .toEqual({ reporterId: 'alice', organizationId: 'acme' });
  });

  it('rejects a signature that covers an organization when none is claimed', () => {
    const withoutOrganization = { id: 'alice', name: 'Alice', identity: signedReporter.identity };
    expect(findVerifiedReporterIdentity(project, withoutOrganization, now)).toBeNull();
  });

  it('verifies the reporter but not an organization the signature does not cover', () => {
    const reporterSignedWithoutOrganization = { ...signedReporter, identity: { expiresAt, signature: signatureV2WithoutOrganization } };
    expect(findVerifiedReporterIdentity(project, reporterSignedWithoutOrganization, now))
      .toEqual({ reporterId: 'alice', organizationId: null });
    const missingOrganization = { id: 'alice', name: 'Alice', identity: reporterSignedWithoutOrganization.identity };
    expect(findVerifiedReporterIdentity(project, missingOrganization, now)).toEqual({ reporterId: 'alice', organizationId: null });
  });

  it('binds the organization to project, reporter and expiry', () => {
    expect(findVerifiedReporterIdentity({ ...project, projectKey: 'other' }, signedReporter, now)).toBeNull();
    expect(findVerifiedReporterIdentity(project, { ...signedReporter, id: 'bob' }, now)).toBeNull();
    expect(findVerifiedReporterIdentity(project, signedReporter, expiresAt * 1000)).toBeNull();
    expect(findVerifiedReporterIdentity(project, signedReporter, now - 86_400_000)).toBeNull();
  });
});

describe('conversation capabilities', () => {
  it('issues independent 256-bit browser capabilities and hashes for storage', () => {
    const first = createConversationSecret();
    const second = createConversationSecret();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(hashConversationSecret(first)).not.toBe(first);
    expect(hashConversationSecret(first)).not.toBe(hashConversationSecret(second));
  });
});
