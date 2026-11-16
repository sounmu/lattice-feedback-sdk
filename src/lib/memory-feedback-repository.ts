import { FeedbackDuplicateTargetError } from '@/lib/feedback-duplicate-target-error';
import type { FeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import type { Feedback } from '@/types/feedback';
import type { ConversationAccess } from '@/types/conversation';
import { appendConversationMessage, canReadConversation } from '@/lib/conversation';
import { TICKET_CLAIM_TTL_MS } from '@/lib/ticket-limits';
import type { TicketClaim } from '@/types/ticket';

export const MAX_FEEDBACK_PER_PROJECT = 1000;

// Kept on globalThis so the store survives dev hot reload. Each list is oldest first.
const globalForFeedbackStore = globalThis as typeof globalThis & {
  memoryFeedbackStore?: Map<string, Feedback[]>;
  memoryConversationAccess?: Map<string, ConversationAccess>;
  memoryTicketClaims?: Map<string, number>;
};

function getStore(): Map<string, Feedback[]> {
  if (!globalForFeedbackStore.memoryFeedbackStore) {
    globalForFeedbackStore.memoryFeedbackStore = new Map();
  }
  return globalForFeedbackStore.memoryFeedbackStore;
}

// When each feedback's ticket was started, by project and id.
function getTicketClaims(): Map<string, number> {
  globalForFeedbackStore.memoryTicketClaims ??= new Map();
  return globalForFeedbackStore.memoryTicketClaims;
}

export function resetMemoryFeedbackStore(): void {
  getStore().clear();
  globalForFeedbackStore.memoryTicketClaims?.clear();
  globalForFeedbackStore.memoryConversationAccess?.clear();
}

export function createMemoryFeedbackRepository(): FeedbackRepository {
  return {
    async create(input, id = crypto.randomUUID(), access) {
      const store = getStore();
      const items = store.get(input.projectKey) ?? [];
      // Refuse new items instead of evicting old ones, so a flood cannot erase existing feedback.
      if (items.length >= MAX_FEEDBACK_PER_PROJECT) {
        throw new FeedbackStorageFullError();
      }
      const now = new Date().toISOString();
      const feedback: Feedback = {
        id,
        projectKey: input.projectKey,
        message: input.message,
        type: input.type,
        status: 'open',
        duplicateOfId: null,
        ticketUrl: null,
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
        adminReply: null,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      items.push(feedback);
      store.set(input.projectKey, items);
      if (access) {
        globalForFeedbackStore.memoryConversationAccess ??= new Map();
        globalForFeedbackStore.memoryConversationAccess.set(id, access);
      }
      return structuredClone(feedback);
    },

    async findMany(projectKey, credentials) {
      const items = getStore().get(projectKey) ?? [];
      const allowed = credentials ? items.filter((item) =>
        canReadConversation(globalForFeedbackStore.memoryConversationAccess?.get(item.id), credentials)) : items;
      return structuredClone(allowed).reverse();
    },

    async find(projectKey, id, credentials) {
      const item = getStore()
        .get(projectKey)
        ?.find((candidate) => candidate.id === id);
      if (!item || (credentials && !canReadConversation(globalForFeedbackStore.memoryConversationAccess?.get(id), credentials))) {
        return null;
      }
      return structuredClone(item);
    },

    async appendReporterMessage(projectKey, id, message) {
      const item = getStore().get(projectKey)?.find((candidate) => candidate.id === id);
      if (!item || !canReadConversation(globalForFeedbackStore.memoryConversationAccess?.get(id), message.credentials)) return null;
      item.messages = appendConversationMessage(item, { authorRole: 'reporter', body: message.body });
      item.updatedAt = new Date().toISOString();
      return structuredClone(item);
    },

    async update(projectKey, id, input) {
      const items = getStore().get(projectKey) ?? [];
      const item = items.find((candidate) => candidate.id === id);
      if (!item) {
        return null;
      }
      if (input.duplicateOfId && input.duplicateOfId !== item.duplicateOfId) {
        const original = items.find((candidate) => candidate.id === input.duplicateOfId);
        if (!original || original === item || original.status === 'duplicate') {
          throw new FeedbackDuplicateTargetError();
        }
      }
      // Validate before changing any fields: a refused append cannot partially save status.
      const messages = input.adminReply?.trim()
        ? appendConversationMessage(item, { authorRole: 'admin', body: input.adminReply })
        : undefined;
      if (messages) item.messages = messages;
      if (input.status !== undefined) {
        item.status = input.status;
      }
      if (input.adminReply !== undefined) {
        // Preserve the legacy reply before clearing its compatibility field.
        if (!input.adminReply && item.messages === undefined && item.adminReply) {
          item.messages = [{ id: `${item.id}:legacy`, authorRole: 'admin', body: item.adminReply, createdAt: item.updatedAt }];
        }
        item.adminReply = input.adminReply;
      }
      if (input.duplicateOfId !== undefined) {
        item.duplicateOfId = input.duplicateOfId;
      }
      if (item.status === 'duplicate' && item.duplicateOfId !== null) {
        // Duplicates of this feedback follow it to its original, so a duplicate never points at a duplicate.
        for (const candidate of items) {
          if (candidate.duplicateOfId === item.id) {
            candidate.duplicateOfId = item.duplicateOfId;
          }
        }
      }
      item.updatedAt = new Date().toISOString();
      return structuredClone(item);
    },

    // Nothing awaits between the check and the write, so two requests cannot both take the claim.
    async claimTicket(projectKey, id): Promise<TicketClaim | null> {
      const item = (getStore().get(projectKey) ?? []).find((candidate) => candidate.id === id);
      if (!item) {
        return null;
      }
      if (item.ticketUrl !== null) {
        return { status: 'created', url: item.ticketUrl };
      }
      const claims = getTicketClaims();
      const claimKey = `${projectKey}:${id}`;
      const now = Date.now();
      const claimedAt = claims.get(claimKey);
      if (claimedAt !== undefined && now - claimedAt < TICKET_CLAIM_TTL_MS) {
        return { status: 'in_progress' };
      }
      claims.set(claimKey, now);
      return { status: 'claimed' };
    },

    async saveTicketUrl(projectKey, id, url) {
      const item = (getStore().get(projectKey) ?? []).find((candidate) => candidate.id === id);
      if (!item) {
        return null;
      }
      item.ticketUrl = url;
      getTicketClaims().delete(`${projectKey}:${id}`);
      return structuredClone(item);
    },

    async releaseTicket(projectKey, id) {
      getTicketClaims().delete(`${projectKey}:${id}`);
    },
  };
}
