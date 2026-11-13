import { NextResponse } from 'next/server';
import { MAX_SCREEN_SNAPSHOT_BYTES } from '@/lib/feedback-limits';
import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { BodyTooLargeError, isDeclaredBodyTooLarge, readBodyTextWithLimit } from '@/lib/http/read-body';
import { consumeRateLimit, getClientAddress, RATE_LIMIT_RETRY_AFTER_SECONDS } from '@/lib/http/rate-limit';
import { isSameOriginRequest } from '@/lib/http/request-origin';
import { findProject, isOriginAllowed } from '@/lib/projects';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { createScreenSnapshotInputSchema } from '@/lib/validation/screen-snapshot-schema';
import type { CreateScreenSnapshotResponse } from '@/types/screen-snapshot';

// Saved screens get their own bucket so a few captures do not use up the feedback submission limit.
const RATE_LIMIT_KEY_PREFIX = 'screen-snapshot:';

function createPayloadTooLargeResponse() {
  return createApiErrorResponse(413, 'payload_too_large', 'The saved screen is too large.');
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return createApiErrorResponse(403, 'cross_origin_request', 'Screens must be saved from the widget.');
  }
  if (!consumeRateLimit(`${RATE_LIMIT_KEY_PREFIX}${getClientAddress(request)}`)) {
    const response = createApiErrorResponse(429, 'rate_limited', 'Too many saved screens. Try again later.');
    response.headers.set('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    return response;
  }
  if (isDeclaredBodyTooLarge(request, MAX_SCREEN_SNAPSHOT_BYTES)) {
    return createPayloadTooLargeResponse();
  }

  let rawBody: string;
  try {
    rawBody = await readBodyTextWithLimit(request, MAX_SCREEN_SNAPSHOT_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return createPayloadTooLargeResponse();
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return createApiErrorResponse(400, 'invalid_json', 'Request body must be valid JSON.');
  }

  const parsed = createScreenSnapshotInputSchema.safeParse(json);
  if (!parsed.success) {
    return createApiErrorResponse(400, 'invalid_body', 'Request body failed validation.');
  }

  const project = findProject(parsed.data.projectKey);
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!isOriginAllowed(project, parsed.data.hostOrigin)) {
    return createApiErrorResponse(403, 'origin_not_allowed', 'Origin is not allowed for this project.');
  }
  const page = new URL(parsed.data.page.url);
  if (page.origin !== parsed.data.hostOrigin) {
    return createApiErrorResponse(400, 'invalid_body', 'The saved page does not belong to the host origin.');
  }
  // Saving is allowed on any page of an allowed origin unless the project's policy restricts the paths.
  if (project.capturePolicy && !project.capturePolicy.allowedPaths.includes(page.pathname)) {
    return createApiErrorResponse(403, 'capture_not_allowed', 'Screens cannot be saved on this page.');
  }

  try {
    const body: CreateScreenSnapshotResponse = { snapshot: await getScreenSnapshotRepository().create(parsed.data) };
    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    if (error instanceof FeedbackStorageFullError) {
      return createApiErrorResponse(503, 'storage_full', 'Screen storage is full.');
    }
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', 'Screen storage is unavailable.');
    }
    throw error;
  }
}
