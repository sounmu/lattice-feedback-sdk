import { NextResponse } from 'next/server';
import { ConversationLimitError } from '@/lib/conversation';
import { consumeRateLimit, getClientAddress } from '@/lib/http/rate-limit';
import { BodyTooLargeError, isDeclaredBodyTooLarge, readBodyTextWithLimit } from '@/lib/http/read-body';
import { FeedbackDuplicateTargetError } from '@/lib/feedback-duplicate-target-error';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { createPrivateJsonResponse } from '@/lib/http/private-json-response';
import { ServerTiming } from '@/lib/http/server-timing';
import { findProject } from '@/lib/projects';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { updateFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import type { Feedback, FeedbackDetailResponse, UpdateFeedbackInput } from '@/types/feedback';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_BODY_BYTES = 32768;

async function createDetailBody(feedback: Feedback): Promise<FeedbackDetailResponse> {
  const screenSnapshots = await getScreenSnapshotRepository().findManyByFeedback(feedback.projectKey, feedback.id);
  return { feedback, screenSnapshots };
}

function createFeedbackNotFoundResponse() {
  return createApiErrorResponse(404, 'feedback_not_found', 'Feedback not found.');
}

export async function GET(request: Request, context: RouteContext) {
  const timing = new ServerTiming();
  const { id } = await context.params;
  const projectKey = new URL(request.url).searchParams.get('projectKey') ?? '';
  const project = findProject(projectKey);
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!(await timing.measure('auth', () => authorizeAdmin(request, project)))) {
    return createApiErrorResponse(401, 'unauthorized', 'Admin authorization is required.');
  }

  try {
    // Both reads are scoped by the project and the id alone, so neither waits for the other. A missing
    // feedback still answers 404 even when the saved-screen read fails.
    const body = await timing.measure('db', async (): Promise<FeedbackDetailResponse | null> => {
      const screenSnapshotsRead = getScreenSnapshotRepository().findManyByFeedback(project.projectKey, id);
      screenSnapshotsRead.catch(() => undefined);
      const feedback = await getFeedbackRepository().find(project.projectKey, id);
      if (!feedback) {
        return null;
      }
      return { feedback, screenSnapshots: await screenSnapshotsRead };
    });
    if (!body) {
      return createFeedbackNotFoundResponse();
    }
    return createPrivateJsonResponse(request, body, timing);
  } catch (error) {
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', error.message);
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const projectKey = new URL(request.url).searchParams.get('projectKey') ?? '';
  const project = findProject(projectKey);
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!authorizeAdmin(request, project)) {
    return createApiErrorResponse(401, 'unauthorized', 'Admin authorization is required.');
  }
  if (!consumeRateLimit(`admin-reply:${projectKey}:${getClientAddress(request)}`, Date.now(), 30)) {
    return createApiErrorResponse(429, 'rate_limited', 'Try again later.');
  }
  if (isDeclaredBodyTooLarge(request, MAX_BODY_BYTES)) {
    return createApiErrorResponse(413, 'payload_too_large', 'Request too large.');
  }

  let json: unknown;
  try {
    json = JSON.parse(await readBodyTextWithLimit(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return createApiErrorResponse(413, 'payload_too_large', 'Request too large.');
    return createApiErrorResponse(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  const parsed = updateFeedbackInputSchema.safeParse(json);
  if (!parsed.success) {
    return createApiErrorResponse(400, 'invalid_body', 'Request body failed validation.');
  }

  const changes: UpdateFeedbackInput = { ...parsed.data };
  if (changes.status !== undefined && changes.status !== 'duplicate') {
    // Leaving the duplicate status drops the link to the original.
    changes.duplicateOfId = null;
  }

  try {
    const feedback = await getFeedbackRepository().update(project.projectKey, id, changes);
    if (!feedback) {
      return createFeedbackNotFoundResponse();
    }
    return NextResponse.json(await createDetailBody(feedback), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ConversationLimitError) {
      return createApiErrorResponse(409, 'conversation_full', error.message);
    }
    if (error instanceof FeedbackDuplicateTargetError) {
      return createApiErrorResponse(400, 'invalid_duplicate_target', error.message);
    }
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', error.message);
    }
    throw error;
  }
}
