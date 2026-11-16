import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { GZIP_MEDIA_TYPE } from '@/lib/gzip';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { ServerTiming } from '@/lib/http/server-timing';
import { findProject } from '@/lib/projects';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import type { ScreenSnapshotDetailResponse } from '@/types/screen-snapshot';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const compressSnapshot = promisify(gzip);

// A saved screen holds the customer's real page data, so it is served only to the project's admin.
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
    const snapshot = await timing.measure('db', () => getScreenSnapshotRepository().find(project.projectKey, id));
    if (!snapshot) {
      return createApiErrorResponse(404, 'screen_snapshot_not_found', 'Saved screen not found.');
    }
    const body: ScreenSnapshotDetailResponse = { snapshot };
    // Encode once, without retaining the large JSON string for the duration of async compression.
    let payload = timing.measureSync('serialize', () => Buffer.from(JSON.stringify(body)));
    let contentType = 'application/json';
    // A long Flow replay is larger than the platform's response limit, so a viewer that asks gets a gzip file.
    if (request.headers.get('accept')?.includes(GZIP_MEDIA_TYPE)) {
      payload = await timing.measure('gzip', () => compressSnapshot(payload, { chunkSize: 64 * 1024 }));
      contentType = GZIP_MEDIA_TYPE;
    }
    return new Response(payload, {
      headers: {
        Vary: 'Accept, Authorization',
        'Cache-Control': 'private, no-store',
        'Content-Type': contentType,
        ...timing.toHeaders(),
      },
    });
  } catch (error) {
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', 'Screen storage is unavailable.');
    }
    throw error;
  }
}
