import { createApiErrorResponse } from '@/lib/http/api-error';
import { consumeRateLimit, getClientAddress, RATE_LIMIT_RETRY_AFTER_SECONDS } from '@/lib/http/rate-limit';
import { isSameOriginRequest } from '@/lib/http/request-origin';
import { findProject, isOriginAllowed } from '@/lib/projects';
import { pageUrlSchema } from '@/lib/validation/feedback-schema';
import type { FindMissingScreenSnapshotAssetsInput } from '@/types/screen-snapshot';

const RATE_LIMIT_KEY_PREFIX = 'screen-asset:';
// One saved screen can carry up to MAX_SNAPSHOT_ASSETS files, each uploaded in its own request.
const MAX_ASSET_REQUESTS_PER_WINDOW = 120;

type ScreenAssetOwner = Pick<FindMissingScreenSnapshotAssetsInput, 'projectKey' | 'hostOrigin' | 'pageUrl'>;

/**
 * Checks an upload from the widget with the same origin and page rules as saving the screen itself,
 * so no file is stored for a page the screen could not be saved on.
 * Returns the error response to send, or null when it may proceed.
 */
export function findScreenAssetUploadError(request: Request, owner: ScreenAssetOwner): Response | null {
  if (!isSameOriginRequest(request)) {
    return createApiErrorResponse(403, 'cross_origin_request', 'Screens must be saved from the widget.');
  }
  if (!consumeRateLimit(`${RATE_LIMIT_KEY_PREFIX}${getClientAddress(request)}`, Date.now(), MAX_ASSET_REQUESTS_PER_WINDOW)) {
    const response = createApiErrorResponse(429, 'rate_limited', 'Too many saved screen files. Try again later.');
    response.headers.set('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    return response;
  }
  const project = findProject(owner.projectKey);
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!isOriginAllowed(project, owner.hostOrigin)) {
    return createApiErrorResponse(403, 'origin_not_allowed', 'Origin is not allowed for this project.');
  }
  const pageUrl = pageUrlSchema.safeParse(owner.pageUrl);
  if (!pageUrl.success || new URL(pageUrl.data).origin !== owner.hostOrigin) {
    return createApiErrorResponse(400, 'invalid_body', 'The saved page does not belong to the host origin.');
  }
  if (project.capturePolicy && !project.capturePolicy.allowedPaths.includes(new URL(pageUrl.data).pathname)) {
    return createApiErrorResponse(403, 'capture_not_allowed', 'Screens cannot be saved on this page.');
  }
  return null;
}
