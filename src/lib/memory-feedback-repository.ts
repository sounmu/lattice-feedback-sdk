import { FeedbackDuplicateTargetError } from '@/lib/feedback-duplicate-target-error';
import type { FeedbackRepository } from '@/lib/feedback-repository';
import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import type { Feedback } from '@/types/feedback';

export const MAX_FEEDBACK_PER_PROJECT = 1000;

// Kept on globalThis so the store survives dev hot reload. Each list is oldest first.
const globalForFeedbackStore = globalThis as typeof globalThis & {
  memoryFeedbackStore?: Map<string, Feedback[]>;
};

function getStore(): Map<string, Feedback[]> {
  if (!globalForFeedbackStore.memoryFeedbackStore) {
    globalForFeedbackStore.memoryFeedbackStore = new Map();
  }
  return globalForFeedbackStore.memoryFeedbackStore;
}

export function resetMemoryFeedbackStore(): void {
  getStore().clear();
}

export function createMemoryFeedbackRepository(): FeedbackRepository {
  return {
    async create(input, id = crypto.randomUUID()) {
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
        reporter: input.reporter,
        page: input.page,
        attachments: {
          comments: input.attachments?.comments ?? [],
          edits: input.attachments?.edits ?? [],
          flow: input.attachments?.flow ?? null,
        },
        adminReply: null,
        createdAt: now,
        updatedAt: now,
      };
      items.push(feedback);
      store.set(input.projectKey, items);
      return structuredClone(feedback);
    },

    async findMany(projectKey) {
      const items = getStore().get(projectKey) ?? [];
      return structuredClone(items).reverse();
    },

    async find(projectKey, id) {
      const item = getStore()
        .get(projectKey)
        ?.find((candidate) => candidate.id === id);
      if (!item) {
        return null;
      }
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
      if (input.status !== undefined) {
        item.status = input.status;
      }
      if (input.adminReply !== undefined) {
        item.adminReply = input.adminReply;
      }
      if (input.duplicateOfId !== undefined) {
        item.duplicateOfId = input.duplicateOfId;
      }
      item.updatedAt = new Date().toISOString();
      return structuredClone(item);
    },
  };
}
