import { FeedbackStorageFullError } from '@/lib/feedback-storage-error';
import type { ScreenSnapshotRepository } from '@/lib/screen-snapshot-repository';
import type { ScreenSnapshot, ScreenSnapshotSummary } from '@/types/screen-snapshot';

export const MAX_SCREEN_SNAPSHOTS_PER_PROJECT = 50;

// Kept on globalThis so the store survives dev hot reload. Each list is oldest first.
const globalForScreenSnapshotStore = globalThis as typeof globalThis & {
  memoryScreenSnapshotStore?: Map<string, ScreenSnapshot[]>;
};

function getStore(): Map<string, ScreenSnapshot[]> {
  if (!globalForScreenSnapshotStore.memoryScreenSnapshotStore) {
    globalForScreenSnapshotStore.memoryScreenSnapshotStore = new Map();
  }
  return globalForScreenSnapshotStore.memoryScreenSnapshotStore;
}

export function resetMemoryScreenSnapshotStore(): void {
  getStore().clear();
}

function toSummary(snapshot: ScreenSnapshot): ScreenSnapshotSummary {
  return {
    id: snapshot.id,
    projectKey: snapshot.projectKey,
    feedbackId: snapshot.feedbackId,
    createdAt: snapshot.createdAt,
    format: snapshot.format,
    capturedAt: snapshot.capturedAt,
    page: { ...snapshot.page },
    missingAssets: snapshot.missingAssets.map((asset) => ({ ...asset })),
  };
}

export function createMemoryScreenSnapshotRepository(): ScreenSnapshotRepository {
  return {
    async create(input) {
      const store = getStore();
      const items = store.get(input.projectKey) ?? [];
      if (items.length >= MAX_SCREEN_SNAPSHOTS_PER_PROJECT) {
        // Only screens the reporter saved but never submitted may be dropped to make room.
        const unlinkedIndex = items.findIndex((item) => item.feedbackId === null);
        if (unlinkedIndex < 0) {
          throw new FeedbackStorageFullError();
        }
        items.splice(unlinkedIndex, 1);
      }
      const snapshot: ScreenSnapshot = {
        id: crypto.randomUUID(),
        projectKey: input.projectKey,
        feedbackId: null,
        createdAt: new Date().toISOString(),
        format: input.format,
        capturedAt: input.capturedAt,
        page: input.page,
        events: input.events,
        missingAssets: input.missingAssets,
      };
      items.push(snapshot);
      store.set(input.projectKey, items);
      return toSummary(snapshot);
    },

    async find(projectKey, id) {
      const item = getStore()
        .get(projectKey)
        ?.find((candidate) => candidate.id === id);
      if (!item) {
        return null;
      }
      // The event payload can be several megabytes, so it is shared instead of cloned. Callers only serialize it.
      return { ...toSummary(item), events: item.events };
    },

    async findManyByFeedback(projectKey, feedbackId) {
      const items = getStore().get(projectKey) ?? [];
      return items.filter((item) => item.feedbackId === feedbackId).map(toSummary);
    },

    // Checked and linked without an await in between, so no other request can interleave.
    async claimForFeedback(projectKey, ids, feedbackId) {
      const items = getStore().get(projectKey) ?? [];
      const claimable = items.filter((item) => ids.includes(item.id) && item.feedbackId === null);
      if (claimable.length !== new Set(ids).size) {
        return false;
      }
      for (const item of claimable) {
        item.feedbackId = feedbackId;
      }
      return true;
    },

    async releaseFromFeedback(projectKey, feedbackId) {
      for (const item of getStore().get(projectKey) ?? []) {
        if (item.feedbackId === feedbackId) {
          item.feedbackId = null;
        }
      }
    },
  };
}
