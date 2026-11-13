import { NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { findProject } from '@/lib/projects';
import { findScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import type { ScreenSnapshotDetailResponse } from '@/types/screen-snapshot';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// A saved screen holds the customer's real page data, so it is served only to the project's admin.
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
  const repository = findScreenSnapshotRepository();
  if (!repository) {
    return createApiErrorResponse(503, 'storage_unavailable', 'Screen storage is unavailable.');
  }
  const snapshot = await repository.find(project.projectKey, id);
  if (!snapshot) {
    return createApiErrorResponse(404, 'screen_snapshot_not_found', 'Saved screen not found.');
  }
  const body: ScreenSnapshotDetailResponse = { snapshot };
  return NextResponse.json(body);
}
