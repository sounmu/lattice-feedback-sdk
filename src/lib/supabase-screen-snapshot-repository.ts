import { z } from 'zod';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import type { ScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import { getSupabaseConfiguration, requestSupabaseRows } from '@/lib/supabase-rest';
import { createScreenSnapshotInputSchema } from '@/lib/validation/screen-snapshot-schema';

const TABLE = 'screen_snapshots';
const SUMMARY_SELECT = [
  'id', 'projectKey:project_key', 'feedbackId:feedback_id', 'createdAt:created_at', 'format',
  'capturedAt:captured_at', 'page', 'missingAssets:missing_assets',
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
});
const summaryRowsSchema = z.array(summaryRowSchema);
const detailRowsSchema = z.array(summaryRowSchema.extend({ events: inputShape.events }));
const idRowsSchema = z.array(z.object({ id: z.uuid() }));

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

    async isAttachable(projectKey, ids) {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0) {
        return true;
      }
      if (!uniqueIds.every(isUuid)) {
        return false;
      }
      const rows = await requestSupabaseRows(configuration, TABLE, {
        select: 'id',
        project_key: `eq.${projectKey}`,
        id: toIdList(uniqueIds),
        feedback_id: 'is.null',
      });
      return parseRows(idRowsSchema, rows).length === uniqueIds.length;
    },

    async attachToFeedback(projectKey, ids, feedbackId) {
      if (ids.length === 0) {
        return;
      }
      // Only screens that are still unlinked are claimed, so a screen never moves between feedbacks.
      await requestSupabaseRows(configuration, TABLE, {
        select: 'id',
        project_key: `eq.${projectKey}`,
        id: toIdList(ids),
        feedback_id: 'is.null',
      }, {
        method: 'PATCH',
        body: JSON.stringify({ feedback_id: feedbackId }),
      });
    },
  };
}
