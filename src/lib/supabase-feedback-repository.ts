import { z } from 'zod';
import type { FeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { createFeedbackInputSchema, updateFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import type { Feedback } from '@/types/feedback';

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
const FEEDBACK_SELECT = [
  'id', 'projectKey:project_key', 'message', 'type', 'status', 'reporter', 'page',
  'attachments', 'adminReply:admin_reply', 'createdAt:created_at', 'updatedAt:updated_at',
].join(',');

const feedbackRowsSchema = z.array(
  createFeedbackInputSchema.omit({ hostOrigin: true }).extend({
    id: z.uuid(),
    status: updateFeedbackInputSchema.shape.status.unwrap(),
    adminReply: updateFeedbackInputSchema.shape.adminReply.unwrap(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  }),
);

const supabaseConfigSchema = z.object({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  }),
  secretKey: z.string().startsWith('sb_secret_'),
});

export function createSupabaseFeedbackRepository(): FeedbackRepository {
  const configuration = supabaseConfigSchema.safeParse({
    url: process.env.SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  });
  if (!configuration.success) {
    throw new FeedbackStorageUnavailableError();
  }
  const { url, secretKey } = configuration.data;

  async function requestRows(parameters: Record<string, string>, options: RequestInit = {}): Promise<Feedback[]> {
    const endpoint = new URL('/rest/v1/feedback', url);
    endpoint.search = new URLSearchParams({ select: FEEDBACK_SELECT, ...parameters }).toString();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        ...options,
        headers: {
          apikey: secretKey,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new FeedbackStorageUnavailableError();
      }
      throw error;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new FeedbackStorageUnavailableError();
    }
    try {
      return feedbackRowsSchema.parse(await response.json());
    } catch (error) {
      if (error instanceof Error) {
        throw new FeedbackStorageUnavailableError();
      }
      throw error;
    }
  }

  return {
    async create(input) {
      const rows = await requestRows({}, {
        method: 'POST',
        body: JSON.stringify({
          project_key: input.projectKey,
          message: input.message,
          type: input.type,
          reporter: input.reporter,
          page: input.page,
          attachments: {
            comments: input.attachments?.comments ?? [],
            edits: input.attachments?.edits ?? [],
            flow: input.attachments?.flow ?? null,
          },
        }),
      });
      const feedback = rows[0];
      if (!feedback) {
        throw new FeedbackStorageUnavailableError();
      }
      return feedback;
    },

    async findMany(projectKey) {
      const items: Feedback[] = [];
      let cursor: Pick<Feedback, 'createdAt' | 'id'> | undefined;
      while (true) {
        const cursorFilter: Record<string, string> = {};
        if (cursor) {
          cursorFilter.or = `(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`;
        }
        const rows = await requestRows({
          project_key: `eq.${projectKey}`,
          order: 'created_at.desc,id.desc',
          limit: String(PAGE_SIZE),
          ...cursorFilter,
        });
        items.push(...rows);
        if (rows.length === 0) {
          return items;
        }
        cursor = rows[rows.length - 1];
      }
    },

    async find(projectKey, id) {
      if (!z.uuid().safeParse(id).success) {
        return null;
      }
      const rows = await requestRows({ project_key: `eq.${projectKey}`, id: `eq.${id}` });
      return rows[0] ?? null;
    },

    async update(projectKey, id, input) {
      if (!z.uuid().safeParse(id).success) {
        return null;
      }
      const rows = await requestRows({ project_key: `eq.${projectKey}`, id: `eq.${id}` }, {
        method: 'PATCH',
        body: JSON.stringify({
          status: input.status,
          admin_reply: input.adminReply,
          updated_at: new Date().toISOString(),
        }),
      });
      return rows[0] ?? null;
    },
  };
}
