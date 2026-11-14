import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createConversationSecret, findVerifiedReporterId, hashConversationSecret } from '@/lib/reporter-identity';
import type { Project } from '@/lib/projects';

const project: Project = { projectKey: 'demo', name: 'Demo', allowedOrigins: [], adminToken: null, capturePolicy: null, identitySecret: 'customer-server-test-secret' };
const now = 1_800_000_000_000;
const expiresAt = now / 1000 + 3600;
// Independent customer-side signing example; the implementation under test only verifies.
const signature = createHmac('sha256', 'customer-server-test-secret')
  .update(JSON.stringify(['lattice-identity-v1', 'demo', 'alice', expiresAt])).digest('hex');
const reporter = { id: 'alice', name: 'Alice', identity: { expiresAt, signature } };

describe('verified reporter identity', () => {
  it('accepts the customer server signature and binds it to project, id and expiry', () => {
    expect(findVerifiedReporterId(project, reporter, now)).toBe('alice');
    expect(findVerifiedReporterId(project, { ...reporter, id: 'bob' }, now)).toBeNull();
    expect(findVerifiedReporterId({ ...project, projectKey: 'other' }, reporter, now)).toBeNull();
    expect(findVerifiedReporterId(project, reporter, expiresAt * 1000)).toBeNull();
    expect(findVerifiedReporterId(project, reporter, now - 86_400_000)).toBeNull();
  });

  it.each([undefined, { expiresAt, signature: '0'.repeat(64) }, { expiresAt, signature: 'bad' }])(
    'treats missing or invalid proof as unverified', (identity) => {
      expect(findVerifiedReporterId(project, { id: 'alice', name: 'Alice', identity }, now)).toBeNull();
    },
  );

  it('never enables verified history without an explicitly configured secret', () => {
    expect(findVerifiedReporterId({ ...project, identitySecret: null }, reporter, now)).toBeNull();
  });

  it('issues independent 256-bit browser capabilities and hashes for storage', () => {
    const first = createConversationSecret();
    const second = createConversationSecret();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(hashConversationSecret(first)).not.toBe(first);
    expect(hashConversationSecret(first)).not.toBe(hashConversationSecret(second));
  });
});
