import { NextResponse } from 'next/server';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { findProject } from '@/lib/projects';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { updateFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import type { Feedback, FeedbackDetailResponse, UpdateFeedbackInput } from '@/types/feedback';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function createDetailBody(feedback: Feedback): Promise<FeedbackDetailResponse> {
  const screenSnapshots = await getScreenSnapshotRepository().findManyByFeedback(feedback.projectKey, feedback.id);
  return { feedback, screenSnapshots };
}

// The original of a duplicate must be another feedback of the same project that is not itself a duplicate.
async function findDuplicateOriginal(projectKey: string, id: string, originalId: string): Promise<Feedback | null> {
  if (originalId.toLowerCase() === id.toLowerCase()) {
    return null;
  }
  const original = await getFeedbackRepository().find(projectKey, originalId);
  if (!original || original.status === 'duplicate') {
    return null;
  }
  return original;
}

function createFeedbackNotFoundResponse() {
  return createApiErrorResponse(404, 'feedback_not_found', 'Feedback not found.');
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const projectKey = new URL(request.url).searchParams.get('projectKey') ?? '';
  const project = findProject(projectKey);
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!authorizeAdmin(request, project)) {
    return createApiErrorResponse(401, 'unauthorized', 'Admin authorization is required.');
  }

  try {
    const feedback = await getFeedbackRepository().find(project.projectKey, id);
    if (!feedback) {
      return createFeedbackNotFoundResponse();
    }
    return NextResponse.json(await createDetailBody(feedback));
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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
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
    if (changes.duplicateOfId && !(await findDuplicateOriginal(project.projectKey, id, changes.duplicateOfId))) {
      return createApiErrorResponse(400, 'invalid_duplicate_target', 'The original must be another feedback of this project that is not a duplicate.');
    }
    const feedback = await getFeedbackRepository().update(project.projectKey, id, changes);
    if (!feedback) {
      return createFeedbackNotFoundResponse();
    }
    return NextResponse.json(await createDetailBody(feedback));
  } catch (error) {
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', error.message);
    }
    throw error;
  }
}
