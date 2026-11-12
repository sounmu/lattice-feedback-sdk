import { timingSafeEqual } from 'node:crypto';
import type { Project } from '@/lib/projects';

const BEARER_PREFIX = 'Bearer ';

export function authorizeAdmin(request: Request, project: Project): boolean {
  if (project.adminToken === null) {
    return false;
  }
  const header = request.headers.get('authorization');
  if (header === null || !header.startsWith(BEARER_PREFIX)) {
    return false;
  }
  const providedBuffer = Buffer.from(header.slice(BEARER_PREFIX.length));
  const expectedBuffer = Buffer.from(project.adminToken);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
