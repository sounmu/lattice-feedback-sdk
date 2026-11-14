import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Project } from '@/lib/projects';
import type { FeedbackReporter } from '@/types/feedback';

export function findVerifiedReporterId(project: Project, reporter: FeedbackReporter | null, now = Date.now()): string | null {
  const proof = reporter?.identity;
  if (!reporter || !proof || !project.identitySecret || !Number.isSafeInteger(proof.expiresAt) ||
    proof.expiresAt * 1000 <= now || proof.expiresAt * 1000 > now + 86_400_000 ||
    !/^[a-f0-9]{64}$/.test(proof.signature)) return null;
  const expected = createHmac('sha256', project.identitySecret)
    .update(JSON.stringify(['lattice-identity-v1', project.projectKey, reporter.id, proof.expiresAt]))
    .digest();
  return timingSafeEqual(expected, Buffer.from(proof.signature, 'hex')) ? reporter.id : null;
}

export function createConversationSecret(): string {
  return randomBytes(32).toString('hex');
}

export function hashConversationSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
