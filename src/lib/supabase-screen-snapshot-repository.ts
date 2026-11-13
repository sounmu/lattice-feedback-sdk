import { z } from 'zod';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import type { ScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { getSupabaseConfiguration, requestSupabaseRows } from '@/lib/supabase-rest';
import { createScreenSnapshotInputSchema } from '@/lib/validation/screen-snapshot-schema';

const TABLE = 'screen_snapshots';
const ASSET_TABLE = 'screen_snapshot_assets';
// PostgREST reads and writes bytea in Postgres hex form.
const BYTEA_HEX_PREFIX = '\\x';
const SUMMARY_SELECT = [
  'id', 'projectKey:project_key', 'feedbackId:feedback_id', 'createdAt:created_at', 'format',
  'capturedAt:captured_at', 'page', 'missingAssets:missing_assets', 'assetHashes:asset_hashes',
].join(',');
// The event payload is large, so only the detail read selects it.
const DETAIL_SELECT = `${SUMMARY_SELECT},events`;

const inputShape = createScreenSnapshotInputSchema.shape;
const summaryRowSchema = z.object({
  id: z.uuid(),
  projectKey: z.string(),
  feedbackId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  format: inputShape.format,
  capturedAt: z.iso.datetime({ offset: true }),
  page: inputShape.page,
  missingAssets: inputShape.missingAssets,
  assetHashes: inputShape.assetHashes,
});
const summaryRowsSchema = z.array(summaryRowSchema);
const detailRowsSchema = z.array(summaryRowSchema.extend({ events: inputShape.events }));
const idRowsSchema = z.array(z.object({ id: z.uuid() }));
const hashRowsSchema = z.array(z.object({ hash: z.string() }));
const assetRowsSchema = z.array(
  z.object({ contentType: z.string(), data: z.string().regex(/^\\x(?:[0-9a-f]{2})*$/) }),
);

function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

function parseRows<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new FeedbackStorageUnavailableError();
  }
  return parsed.data;
}

function toIdList(ids: readonly string[]): string {
  return `in.(${ids.join(',')})`;
}

export function createSupabaseScreenSnapshotRepository(): ScreenSnapshotRepository {
  const configuration = getSupabaseConfiguration();

  async function releaseFromFeedback(projectKey: string, feedbackId: string): Promise<void> {
    await requestSupabaseRows(configuration, TABLE, {
      select: 'id',
      project_key: `eq.${projectKey}`,
      feedback_id: `eq.${feedbackId}`,
    }, {
      method: 'PATCH',
      body: JSON.stringify({ feedback_id: null }),
    });
  }

  return {
    async create(input) {
      const rows = await requestSupabaseRows(configuration, TABLE, { select: SUMMARY_SELECT }, {
        method: 'POST',
        body: JSON.stringify({
          project_key: input.projectKey,
          format: input.format,
          captured_at: input.capturedAt,
          page: input.page,
          events: input.events,
          missing_assets: input.missingAssets,
          asset_hashes: input.assetHashes,
        }),
      });
      const snapshot = parseRows(summaryRowsSchema, rows)[0];
      if (!snapshot) {
        throw new FeedbackStorageUnavailableError();
      }
      return snapshot;
    },

    async find(projectKey, id) {
      if (!isUuid(id)) {
        return null;
      }
      const rows = await requestSupabaseRows(configuration, TABLE, {
        select: DETAIL_SELECT,
        project_key: `eq.${projectKey}`,
        id: `eq.${id}`,
      });
      return parseRows(detailRowsSchema, rows)[0] ?? null;
    },

    async findManyByFeedback(projectKey, feedbackId) {
      if (!isUuid(feedbackId)) {
        return [];
      }
      const rows = await requestSupabaseRows(configuration, TABLE, {
        select: SUMMARY_SELECT,
        project_key: `eq.${projectKey}`,
        feedback_id: `eq.${feedbackId}`,
        order: 'created_at.asc,id.asc',
      });
      return parseRows(summaryRowsSchema, rows);
    },

    async claimForFeedback(projectKey, ids, feedbackId) {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0) {
        return true;
      }
      if (!uniqueIds.every(isUuid)) {
        return false;
      }
      let claimedCount: number;
      try {
        // One conditional UPDATE: a screen another request already claimed is not matched, so it never moves.
        const rows = await requestSupabaseRows(configuration, TABLE, {
          select: 'id',
          project_key: `eq.${projectKey}`,
          id: toIdList(uniqueIds),
          feedback_id: 'is.null',
        }, {
          method: 'PATCH',
          body: JSON.stringify({ feedback_id: feedbackId }),
        });
        claimedCount = parseRows(idRowsSchema, rows).length;
      } catch (error) {
        // The UPDATE may have committed even though its response was lost, so the claim is undone before failing.
        await releaseFromFeedback(projectKey, feedbackId).catch((releaseError: unknown) =>
          console.error('Releasing saved screens after a failed claim failed.', releaseError),
        );
        throw error;
      }
      if (claimedCount === uniqueIds.length) {
        return true;
      }
      await releaseFromFeedback(projectKey, feedbackId);
      return false;
    },

    releaseFromFeedback,

    async findMissingAssetHashes(projectKey, hashes) {
      const uniqueHashes = [...new Set(hashes)];
      if (uniqueHashes.length === 0) {
        return [];
      }
      const rows = await requestSupabaseRows(configuration, ASSET_TABLE, {
        select: 'hash',
        project_key: `eq.${projectKey}`,
        hash: `in.(${uniqueHashes.join(',')})`,
      });
      const stored = new Set(parseRows(hashRowsSchema, rows).map((row) => row.hash));
      return uniqueHashes.filter((hash) => !stored.has(hash));
    },

    async saveAsset({ projectKey, hash, contentType, data }) {
      await requestSupabaseRows(configuration, ASSET_TABLE, { select: 'hash', on_conflict: 'project_key,hash' }, {
        method: 'POST',
        body: JSON.stringify({
          project_key: projectKey,
          hash,
          content_type: contentType,
          byte_size: data.byteLength,
          data: `${BYTEA_HEX_PREFIX}${Buffer.from(data).toString('hex')}`,
        }),
      }, ['resolution=ignore-duplicates']);
    },

    async findAsset(projectKey, hash) {
      const rows = await requestSupabaseRows(configuration, ASSET_TABLE, {
        select: 'contentType:content_type,data',
        project_key: `eq.${projectKey}`,
        hash: `eq.${hash}`,
      });
      const asset = parseRows(assetRowsSchema, rows)[0];
      if (!asset) {
        return null;
      }
      return {
        contentType: asset.contentType,
        data: new Uint8Array(Buffer.from(asset.data.slice(BYTEA_HEX_PREFIX.length), 'hex')),
      };
    },
  };
}
