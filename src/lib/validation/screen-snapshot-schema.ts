import { z } from 'zod';
import { MAX_MISSING_SNAPSHOT_ASSETS, MAX_PAGE_TITLE_LENGTH, MAX_SNAPSHOT_ASSETS, truncateText } from '@/lib/feedback-limits';
import { RRWEB_FULL_SNAPSHOT_EVENT_TYPE, RRWEB_META_EVENT_TYPE, SCREEN_SNAPSHOT_FORMAT } from '@/lib/screen-snapshot';
import { SNAPSHOT_ASSET_HASH_PATTERN } from '@/lib/snapshot-asset-references';
import { isHttpOrigin, pageUrlSchema } from '@/lib/validation/feedback-schema';
import type { CreateScreenSnapshotInput, FindMissingScreenSnapshotAssetsInput } from '@/types/screen-snapshot';

const MAX_SHORT_TEXT_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_VIEWPORT_SIZE = 16384;
const MAX_SCROLL_OFFSET = 10_000_000;

// The event payload is opaque here: only the replayer interprets it, inside a sandboxed iframe.
function createEventSchema(type: number) {
  return z.object({
    type: z.literal(type),
    timestamp: z.number().nonnegative(),
    data: z.record(z.string(), z.unknown()),
  });
}

export const snapshotAssetHashSchema = z.string().regex(SNAPSHOT_ASSET_HASH_PATTERN);
const projectKeySchema = z.string().min(1).max(MAX_SHORT_TEXT_LENGTH);
const hostOriginSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine(isHttpOrigin, { message: 'hostOrigin must be an http(s) origin without a path' });

const viewportSizeSchema = z.number().positive().max(MAX_VIEWPORT_SIZE);
const scrollOffsetSchema = z.number().min(-MAX_SCROLL_OFFSET).max(MAX_SCROLL_OFFSET);

export const createScreenSnapshotInputSchema = z.object({
  projectKey: projectKeySchema,
  hostOrigin: hostOriginSchema,
  format: z.literal(SCREEN_SNAPSHOT_FORMAT),
  capturedAt: z.iso.datetime(),
  page: z.object({
    url: pageUrlSchema,
    title: z.string().transform((value) => truncateText(value, MAX_PAGE_TITLE_LENGTH)),
    viewportWidth: viewportSizeSchema,
    viewportHeight: viewportSizeSchema,
    scrollX: scrollOffsetSchema,
    scrollY: scrollOffsetSchema,
  }),
  events: z.tuple([createEventSchema(RRWEB_META_EVENT_TYPE), createEventSchema(RRWEB_FULL_SNAPSHOT_EVENT_TYPE)]),
  missingAssets: z
    .array(
      z.object({
        url: z.string().max(MAX_URL_LENGTH),
        reason: z.enum(['fetch_failed', 'too_large', 'budget_exceeded']),
      }),
    )
    .max(MAX_MISSING_SNAPSHOT_ASSETS),
  // The same file may be referenced from several places, so hashes can repeat.
  assetHashes: z.array(snapshotAssetHashSchema).max(MAX_SNAPSHOT_ASSETS),
});

export const findMissingScreenSnapshotAssetsInputSchema = z.object({
  projectKey: projectKeySchema,
  hostOrigin: hostOriginSchema,
  hashes: z.array(snapshotAssetHashSchema).min(1).max(MAX_SNAPSHOT_ASSETS),
});

type IsAssignable<TFrom, TTo> = [TFrom] extends [TTo] ? true : false;
type AssertTrue<T extends true> = T;
export type CreateScreenSnapshotSchemaMatchesType = AssertTrue<
  IsAssignable<z.output<typeof createScreenSnapshotInputSchema>, CreateScreenSnapshotInput>
>;
export type FindMissingScreenSnapshotAssetsSchemaMatchesType = AssertTrue<
  IsAssignable<z.output<typeof findMissingScreenSnapshotAssetsInputSchema>, FindMissingScreenSnapshotAssetsInput>
>;
