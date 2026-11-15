import { z } from 'zod';
import { FeedbackDuplicateTargetError } from '@/lib/feedback-duplicate-target-error';
import type { FeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { getSupabaseConfiguration } from '@/lib/supabase-rest';
import { createFeedbackInputSchema, updateFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import type { Feedback } from '@/types/feedback';
import type { ConversationCredentials } from '@/types/conversation';
import { conversationMessagesSchema } from '@/lib/validation/conversation-schema';
import { ConversationLimitError } from '@/lib/conversation';

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
const FEEDBACK_SELECT = [
  'id', 'projectKey:project_key', 'message', 'type', 'status', 'duplicateOfId:duplicate_of', 'reporter', 'page',
  'attachments', 'adminReply:admin_reply', 'createdAt:created_at', 'updatedAt:updated_at', 'messages',
].join(',');

// How Postgres reports a refused original: a foreign key violation (missing, or in another project) or a
// check violation (the feedback itself, or one that is already a duplicate).
const DUPLICATE_TARGET_ERROR_CODES = ['23503', '23514'];

async function isDuplicateTargetRefusal(response: Response): Promise<boolean> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return false;
  }
  return typeof body.code === 'string' && DUPLICATE_TARGET_ERROR_CODES.includes(body.code);
}

const feedbackRowsSchema = z.array(
  createFeedbackInputSchema.omit({ hostOrigin: true }).extend({
    id: z.uuid(),
    status: updateFeedbackInputSchema.shape.status.unwrap(),
    duplicateOfId: z.uuid().nullable(),
    adminReply: updateFeedbackInputSchema.shape.adminReply.unwrap(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    messages: conversationMessagesSchema.optional(),
  }),
);

export function createSupabaseFeedbackRepository(): FeedbackRepository {
  const { url, secretKey } = getSupabaseConfiguration();

  async function requestRows(
    parameters: Record<string, string>,
    options: RequestInit = {},
    setsDuplicateTarget = false,
    table = 'feedback',
  ): Promise<Feedback[]> {
    const endpoint = new URL(`/rest/v1/${table}`, url);
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
      if (response.status === 409) {
        const failure: unknown = await response.clone().json().catch(() => null);
        if (typeof failure === 'object' && failure !== null && 'code' in failure && failure.code === 'PT409') {
          await response.body?.cancel();
          throw new ConversationLimitError();
        }
      }
      // The error body is read only where its code changes the outcome.
      if (!setsDuplicateTarget) {
        await response.body?.cancel();
        throw new FeedbackStorageUnavailableError();
      }
      if (await isDuplicateTargetRefusal(response)) {
        throw new FeedbackDuplicateTargetError();
      }
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
    async create(input, id, access) {
      const rows = await requestRows({}, {
        method: 'POST',
        body: JSON.stringify({
          ...(id === undefined ? {} : { id }),
          ...(access ? { browser_secret_hash: access.browserSecretHash, verified_reporter_id: access.verifiedReporterId } : {}),
          project_key: input.projectKey,
          message: input.message,
          type: input.type,
          reporter: {
            id: input.reporter.id, name: input.reporter.name,
            ...(input.reporter.email === undefined ? {} : { email: input.reporter.email }),
          },
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

    async findMany(projectKey, credentials) {
      if (credentials) {
        return requestRows({}, { method: 'POST', body: JSON.stringify({
          p_project: projectKey, p_id: null, ...getCredentialParameters(credentials),
        }) }, false, 'rpc/read_reporter_conversations');
      }
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

    async find(projectKey, id, credentials) {
      if (!z.uuid().safeParse(id).success) {
        return null;
      }
      const rows = credentials
        ? await requestRows({}, { method: 'POST', body: JSON.stringify({
          p_project: projectKey, p_id: id, ...getCredentialParameters(credentials),
        }) }, false, 'rpc/read_reporter_conversations')
        : await requestRows({ project_key: `eq.${projectKey}`, id: `eq.${id}` });
      return rows[0] ?? null;
    },

    async appendReporterMessage(projectKey, id, message) {
      if (!z.uuid().safeParse(id).success) return null;
      const rows = await requestRows({}, { method: 'POST', body: JSON.stringify({
        p_project: projectKey, p_id: id, p_body: message.body, ...getCredentialParameters(message.credentials),
      }) }, false, 'rpc/append_reporter_message');
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
          duplicate_of: input.duplicateOfId,
          admin_reply: input.adminReply,
          updated_at: new Date().toISOString(),
        }),
      }, typeof input.duplicateOfId === 'string');
      return rows[0] ?? null;
    },
  };
}

function getCredentialParameters(credentials: ConversationCredentials) {
  return { p_hashes: credentials.browserSecretHashes, p_reporter: credentials.verifiedReporterId };
}
