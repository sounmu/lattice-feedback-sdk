import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Project } from '@/lib/projects';
import type { FeedbackReporter } from '@/types/feedback';

const MAX_PROOF_LIFETIME_MS = 86_400_000;

export interface VerifiedReporterIdentity {
  reporterId: string;
  /** Null unless a v2 signature covers the organization id the reporter claimed. */
  organizationId: string | null;
}

function isSignatureFor(secret: string, payload: unknown[], signature: string): boolean {
  const expected = createHmac('sha256', secret).update(JSON.stringify(payload)).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/**
 * Checks the customer server's signature. v2 signs [version, projectKey, reporterId, organizationId | null, expiresAt];
 * v1 signs the same without an organization and is still accepted, but verifies the reporter only.
 * A claimed organization the signature does not cover is never returned as verified.
 */
export function findVerifiedReporterIdentity(
  project: Project, reporter: FeedbackReporter | null, now = Date.now(),
): VerifiedReporterIdentity | null {
  const proof = reporter?.identity;
  if (!reporter || !proof || !project.identitySecret || !Number.isSafeInteger(proof.expiresAt) ||
    proof.expiresAt * 1000 <= now || proof.expiresAt * 1000 > now + MAX_PROOF_LIFETIME_MS ||
    !/^[a-f0-9]{64}$/.test(proof.signature)) return null;
  const claimedOrganizationId = reporter.organization?.id ?? null;
  const { projectKey } = project;
  const attempts: { organizationId: string | null; payload: unknown[] }[] = [
    { organizationId: claimedOrganizationId, payload: ['lattice-identity-v2', projectKey, reporter.id, claimedOrganizationId, proof.expiresAt] },
  ];
  if (claimedOrganizationId !== null) {
    attempts.push({ organizationId: null, payload: ['lattice-identity-v2', projectKey, reporter.id, null, proof.expiresAt] });
  }
  attempts.push({ organizationId: null, payload: ['lattice-identity-v1', projectKey, reporter.id, proof.expiresAt] });
  const match = attempts.find((attempt) => isSignatureFor(project.identitySecret as string, attempt.payload, proof.signature));
  return match ? { reporterId: reporter.id, organizationId: match.organizationId } : null;
}

export function createConversationSecret(): string {
  return randomBytes(32).toString('hex');
}

export function hashConversationSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
