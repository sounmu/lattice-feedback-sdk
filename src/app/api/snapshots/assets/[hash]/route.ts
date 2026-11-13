import { createHash } from 'node:crypto';
import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { MAX_SNAPSHOT_ASSET_BYTES } from '@/lib/feedback-limits';
import { authorizeAdmin } from '@/lib/http/admin-auth';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { BodyTooLargeError, isDeclaredBodyTooLarge, readBodyBytesWithLimit } from '@/lib/http/read-body';
import { findProject } from '@/lib/projects';
import { SNAPSHOT_ASSET_HASH_PATTERN } from '@/lib/snapshot-asset-references';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { findScreenAssetUploadError } from '@/app/api/snapshots/assets/screen-asset-access';

interface RouteContext {
  params: Promise<{ hash: string }>;
}

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
// Only font and image types are kept; anything else is stored as opaque bytes.
const ALLOWED_CONTENT_TYPE_PATTERN =
  /^(?:font\/[a-z0-9.+-]+|image\/[a-z0-9.+-]+|application\/(?:font-woff2?|x-font-[a-z0-9]+|vnd\.ms-fontobject))$/;

function getStoredContentType(header: string | null): string {
  const contentType = header?.split(';')[0].trim().toLowerCase() ?? '';
  if (ALLOWED_CONTENT_TYPE_PATTERN.test(contentType)) {
    return contentType;
  }
  return DEFAULT_CONTENT_TYPE;
}

function createStorageErrorResponse(error: unknown): Response {
  if (error instanceof FeedbackStorageFullError) {
    return createApiErrorResponse(503, 'storage_full', 'Screen storage is full.');
  }
  if (error instanceof FeedbackStorageUnavailableError) {
    return createApiErrorResponse(503, 'storage_unavailable', 'Screen storage is unavailable.');
  }
  throw error;
}

export async function PUT(request: Request, context: RouteContext) {
  const { hash } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  const projectKey = searchParams.get('projectKey') ?? '';
  const uploadError = findScreenAssetUploadError(request, {
    projectKey,
    hostOrigin: searchParams.get('hostOrigin') ?? '',
    pageUrl: searchParams.get('pageUrl') ?? '',
  });
  if (uploadError) {
    return uploadError;
  }
  if (!SNAPSHOT_ASSET_HASH_PATTERN.test(hash)) {
    return createApiErrorResponse(400, 'invalid_asset_hash', 'The file hash is not a SHA-256 hex digest.');
  }
  if (isDeclaredBodyTooLarge(request, MAX_SNAPSHOT_ASSET_BYTES)) {
    return createApiErrorResponse(413, 'payload_too_large', 'The file is too large.');
  }
  let data: Uint8Array;
  try {
    data = await readBodyBytesWithLimit(request, MAX_SNAPSHOT_ASSET_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return createApiErrorResponse(413, 'payload_too_large', 'The file is too large.');
    }
    throw error;
  }
  // The hash is the file's identity across screens, so a client cannot store bytes under another file's name.
  if (createHash('sha256').update(data).digest('hex') !== hash) {
    return createApiErrorResponse(400, 'asset_hash_mismatch', 'The file does not match its hash.');
  }
  try {
    await getScreenSnapshotRepository().saveAsset({
      projectKey,
      hash,
      contentType: getStoredContentType(request.headers.get('content-type')),
      data,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return createStorageErrorResponse(error);
  }
}

// Served only to the project's admin. The viewer fetches it with the admin token and loads it from a blob: URL.
export async function GET(request: Request, context: RouteContext) {
  const { hash } = await context.params;
  const project = findProject(new URL(request.url).searchParams.get('projectKey') ?? '');
  if (!project) {
    return createApiErrorResponse(404, 'project_not_found', 'Project not found.');
  }
  if (!authorizeAdmin(request, project)) {
    return createApiErrorResponse(401, 'unauthorized', 'Admin authorization is required.');
  }
  try {
    const asset = SNAPSHOT_ASSET_HASH_PATTERN.test(hash)
      ? await getScreenSnapshotRepository().findAsset(project.projectKey, hash)
      : null;
    if (!asset) {
      return createApiErrorResponse(404, 'screen_snapshot_asset_not_found', 'Saved screen file not found.');
    }
    return new Response(asset.data.slice(), {
      headers: {
        'Content-Type': asset.contentType,
        // Customer data behind the admin token: never kept by the browser, so every read is authorized again.
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return createStorageErrorResponse(error);
  }
}
