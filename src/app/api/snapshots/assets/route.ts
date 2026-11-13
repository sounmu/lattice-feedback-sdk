import { NextResponse } from 'next/server';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createApiErrorResponse } from '@/lib/http/api-error';
import { BodyTooLargeError, readBodyTextWithLimit } from '@/lib/http/read-body';
import { getScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { findMissingScreenSnapshotAssetsInputSchema } from '@/lib/validation/screen-snapshot-schema';
import { findScreenAssetUploadError } from '@/app/api/snapshots/assets/screen-asset-access';
import type { FindMissingScreenSnapshotAssetsResponse } from '@/types/screen-snapshot';

const MAX_BODY_BYTES = 16384;

// Lets the widget skip files the project already stored, such as a font shared by every screen.
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = JSON.parse(await readBodyTextWithLimit(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return createApiErrorResponse(413, 'payload_too_large', 'Request body is too large.');
    }
    return createApiErrorResponse(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  const parsed = findMissingScreenSnapshotAssetsInputSchema.safeParse(json);
  if (!parsed.success) {
    return createApiErrorResponse(400, 'invalid_body', 'Request body failed validation.');
  }
  const uploadError = findScreenAssetUploadError(request, parsed.data.projectKey, parsed.data.hostOrigin);
  if (uploadError) {
    return uploadError;
  }
  try {
    const missingHashes = await getScreenSnapshotRepository().findMissingAssetHashes(
      parsed.data.projectKey,
      parsed.data.hashes,
    );
    const body: FindMissingScreenSnapshotAssetsResponse = { missingHashes };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof FeedbackStorageUnavailableError) {
      return createApiErrorResponse(503, 'storage_unavailable', 'Screen storage is unavailable.');
    }
    throw error;
  }
}
