import { z } from 'zod';
import { FeedbackDuplicateTargetError } from '@/lib/feedback-duplicate-target-error';
import type { FeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageUnavailableError } from '@/lib/feedback-storage-unavailable-error';
import { getSupabaseConfiguration } from '@/lib/supabase-rest';
import { createFeedbackInputSchema, updateFeedbackInputSchema } from '@/lib/validation/feedback-schema';
import type { Feedback } from '@/types/feedback';
import type { ConversationCredentials } from '@/types/conversation';
import { conversationMessagesSchema, reporterOrganizationSchema } from '@/lib/validation/conversation-schema';
import { ConversationLimitError } from '@/lib/conversation';
import { TICKET_CLAIM_TTL_MS } from '@/lib/ticket-limits';
import type { TicketClaim } from '@/types/ticket';

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
const FEEDBACK_SELECT = [
  'id', 'projectKey:project_key', 'message', 'type', 'status', 'duplicateOfId:duplicate_of', 'ticketUrl:ticket_url', 'reporter', 'page',
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
    reporter: createFeedbackInputSchema.shape.reporter.extend({ verifiedOrganization: reporterOrganizationSchema.optional() }),
    status: updateFeedbackInputSchema.shape.status.unwrap(),
    duplicateOfId: z.uuid().nullable(),
    ticketUrl: z.string().max(2048).nullable(),
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

  const repository: FeedbackRepository = {
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
            ...(input.reporter.verifiedOrganization === undefined ? {} : { verifiedOrganization: input.reporter.verifiedOrganization }),
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
        const parameters = {
          order: 'created_at.desc,id.desc',
          limit: String(PAGE_SIZE),
        };
        // A tuple comparison lets Postgres seek in the existing project/created/id index.
        const rows = cursor
          ? await requestRows(parameters, { method: 'POST', body: JSON.stringify({
            p_project: projectKey, p_created_at: cursor.createdAt, p_id: cursor.id,
          }) }, false, 'rpc/read_feedback_before')
          : await requestRows({ ...parameters, project_key: `eq.${projectKey}` });
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

    // One UPDATE with the conditions in its WHERE, so the database lets only one of two requests at once take it.
    async claimTicket(projectKey, id): Promise<TicketClaim | null> {
      if (!z.uuid().safeParse(id).success) {
        return null;
      }
      const now = Date.now();
      const claimed = await requestRows({
        project_key: `eq.${projectKey}`,
        id: `eq.${id}`,
        ticket_url: 'is.null',
        or: `(ticket_claimed_at.is.null,ticket_claimed_at.lt.${new Date(now - TICKET_CLAIM_TTL_MS).toISOString()})`,
      }, { method: 'PATCH', body: JSON.stringify({ ticket_claimed_at: new Date(now).toISOString() }) });
      if (claimed.length > 0) {
        return { status: 'claimed' };
      }
      const current = await repository.find(projectKey, id);
      if (!current) {
        return null;
      }
      return current.ticketUrl === null ? { status: 'in_progress' } : { status: 'created', url: current.ticketUrl };
    },

    async saveTicketUrl(projectKey, id, url) {
      if (!z.uuid().safeParse(id).success) {
        return null;
      }
      const rows = await requestRows({ project_key: `eq.${projectKey}`, id: `eq.${id}` }, {
        method: 'PATCH',
        body: JSON.stringify({ ticket_url: url, ticket_claimed_at: null }),
      });
      return rows[0] ?? null;
    },

    async releaseTicket(projectKey, id) {
      if (!z.uuid().safeParse(id).success) {
        return;
      }
      await requestRows({ project_key: `eq.${projectKey}`, id: `eq.${id}`, ticket_url: 'is.null' }, {
        method: 'PATCH',
        body: JSON.stringify({ ticket_claimed_at: null }),
      });
    },
  };
  return repository;
}

function getCredentialParameters(credentials: ConversationCredentials) {
  return { p_hashes: credentials.browserSecretHashes, p_reporter: credentials.verifiedReporterId };
}
