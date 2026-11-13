import { NextResponse } from 'next/server';
import { getFeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { findProject } from '@/lib/projects';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { updateFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import type { Feedback, FeedbackDetailResponse } from '@/types/feedback';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function createDetailBody(feedback: Feedback): Promise<FeedbackDetailResponse> {
  const screenSnapshots = await getScreenSnapshotRepository().findManyByFeedback(feedback.projectKey, feedback.id);
  return { feedback, screenSnapshots };
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

  try {
    const feedback = await getFeedbackRepository().update(project.projectKey, id, parsed.data);
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
