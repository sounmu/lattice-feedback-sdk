import { NextResponse } from 'next/server';
import { areFeedbackAttachmentsAllowed } from '@/lib/capture-policy';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { BodyTooLargeError, isDeclaredBodyTooLarge, readBodyTextWithLimit } from '@/lib/http/read-body';
import { consumeRateLimit, getClientAddress, RATE_LIMIT_RETRY_AFTER_SECONDS } from '@/lib/http/rate-limit';
import { isSameOriginRequest } from '@/lib/http/request-origin';
import { findProject, isOriginAllowed } from '@/lib/projects';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { createFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import { createFeedbackWithClaimedScreens } from '@/lib/feedback-submission';
import { createConversationSecret, findVerifiedReporterId, hashConversationSecret } from '@/lib/reporter-identity';
import type { CreateFeedbackResponse, Feedback, FeedbackListResponse } from '@/types/feedback';

const MAX_BODY_BYTES = 65536;

function createPayloadTooLargeResponse() {
  return createApiErrorResponse(413, 'payload_too_large', 'Request body is too large.');
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return createApiErrorResponse(403, 'cross_origin_request', 'Feedback must be submitted from the widget.');
  }
  if (!consumeRateLimit(getClientAddress(request))) {
    const response = createApiErrorResponse(429, 'rate_limited', 'Too many feedback requests. Try again later.');
    response.headers.set('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    return response;
  }
  if (isDeclaredBodyTooLarge(request, MAX_BODY_BYTES)) {
    return createPayloadTooLargeResponse();
  }

  // The header can be absent or wrong, so the stream itself is capped as well.
  let rawBody: string;
  try {
    rawBody = await readBodyTextWithLimit(request, MAX_BODY_BYTES);
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

  const parsed = createFeedbackInputSchema.safeParse(json);
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
  if (!areFeedbackAttachmentsAllowed(parsed.data, project.capturePolicy)) {
    return createApiErrorResponse(403, 'capture_not_allowed', 'Captured context is not allowed for this project.');
  }

  const { screenSnapshotIds, ...feedbackInput } = parsed.data;
  const conversationSecret = createConversationSecret();
  const access = {
    browserSecretHash: hashConversationSecret(conversationSecret),
    verifiedReporterId: findVerifiedReporterId(project, feedbackInput.reporter),
  };
  // The identity proof is a bearer credential, never reporter metadata.
  delete feedbackInput.reporter.identity;
  try {
    // Screens are claimed for the new id before the feedback is stored, so two submissions can never
    // both report success for the same screen.
    const feedbackId = crypto.randomUUID();
    if (screenSnapshotIds.length > 0) {
      const screens = getScreenSnapshotRepository();
      if (!(await screens.claimForFeedback(project.projectKey, screenSnapshotIds, feedbackId))) {
        return createApiErrorResponse(400, 'screen_snapshot_not_found', 'A saved screen is missing or already submitted.');
      }
    }
    const feedbackRepository = getFeedbackRepository();
    let feedback: Feedback;
    if (screenSnapshotIds.length > 0) {
      feedback = await createFeedbackWithClaimedScreens({
        feedbackRepository,
        screenSnapshotRepository: getScreenSnapshotRepository(),
        input: feedbackInput,
        id: feedbackId,
        access,
      });
    } else {
      feedback = await feedbackRepository.create(feedbackInput, feedbackId, access);
    }
    const body: CreateFeedbackResponse = { feedback, conversationSecret };
    return NextResponse.json(body, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof FeedbackStorageFullError) {
      return createApiErrorResponse(503, 'storage_full', 'Feedback storage is full.');
    }
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', error.message);
    }
    throw error;
  }
}

export async function GET(request: Request) {
  const projectKey = new URL(request.url).searchParams.get('projectKey') ?? '';
  const project = findProject(projectKey);
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!authorizeAdmin(request, project)) {
    return createApiErrorResponse(401, 'unauthorized', 'Admin authorization is required.');
  }

  try {
    const items = await getFeedbackRepository().findMany(project.projectKey);
    const body: FeedbackListResponse = { items };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', error.message);
    }
    throw error;
  }
}
