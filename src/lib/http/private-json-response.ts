import { createHash } from 'node:crypto';

/** Called only after authorization and a fresh repository read, for successful admin GETs. */
export function createPrivateJsonResponse(request: Request, body: object): Response {
  const json = Buffer.from(JSON.stringify(body));
  // Hash the representation, not updatedAt: linked screens and duplicate links can change independently.
  const tag = `"${createHash('sha256').update(json).digest('base64url')}"`;
  const headers = {
    'Cache-Control': 'private, no-cache',
    'Content-Type': 'application/json',
    ETag: `W/${tag}`,
    Vary: 'Authorization',
  };
  const condition = request.headers.get('if-none-match');
  const matches = condition?.trim() === '*' ||
    condition?.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === tag);
  if (matches) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(json, { headers });
}
