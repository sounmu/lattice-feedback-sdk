import { createHash } from 'node:crypto';
import { ServerTiming } from '@/lib/http/server-timing';

/** Called only after authorization and a fresh repository read, for successful admin GETs. */
export function createPrivateJsonResponse(request: Request, body: object, timing?: ServerTiming): Response {
  const { json, tag } = (timing ?? new ServerTiming()).measureSync('serialize', () => {
    const bytes = Buffer.from(JSON.stringify(body));
    // Hash the representation, not updatedAt: linked screens and duplicate links can change independently.
    return { json: bytes, tag: `"${createHash('sha256').update(bytes).digest('base64url')}"` };
  });
  const headers = {
    'Cache-Control': 'private, no-cache',
    'Content-Type': 'application/json',
    ETag: `W/${tag}`,
    Vary: 'Authorization',
    ...timing?.toHeaders(),
  };
  const condition = request.headers.get('if-none-match');
  const matches = condition?.trim() === '*' ||
    condition?.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === tag);
  if (matches) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(json, { headers });
}
