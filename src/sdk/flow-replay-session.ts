// Keeps a Flow replay across a reload or full navigation in the same tab. IndexedDB of the host origin holds
// the events, which the recorder has already cleaned, and sessionStorage holds how far the last document got.
// Both are written only while a Flow records and removed when its replay is taken or cancelled; what a
// closed tab leaves behind is removed once no Flow could still be running.
import { mergeStashedChunks, parseStashedChunks } from '@/sdk/flow-replay-segment';
import { clearFlowSession, findSessionStorage, FLOW_MAX_DURATION_MS } from '@/sdk/flow-session';
import type { ScreenSnapshotEvent, ScreenSnapshotPage } from '@/types/screen-snapshot';

const DATABASE_NAME = 'lattice-feedback-flow-replay';
const STORE_NAME = 'chunks';
const SAVED_AT = 'savedAt';
// A write to IndexedDB can still be under way when the document is left, so what is not yet saved is stashed
// in sessionStorage then. A tail too large for that is left out, and the next document marks the gap.
const MAX_STASH_CHARS = 1_000_000;

/** A run of events one document recorded, saved together. */
export interface ReplayChunk {
  /** Which document of the Flow recorded this, counted from 0, and its place among that document's chunks. */
  segment: number;
  index: number;
  /** Null for a page that is not recorded. */
  page: ScreenSnapshotPage | null;
  /** Events recorded before this document were lost. */
  gapBefore: boolean;
  /** The replay stopped here for good: a limit was reached or it was cut off. */
  ended: boolean;
  events: ScreenSnapshotEvent[];
  /** Size of the events as counted against the replay limit. */
  bytes: number;
  usedCssImageUrls: string[];
  loadedFontFamilies: string[];
  liveImageSources: [number, string][];
}

export interface ReplayProgress {
  segment: number;
  eventCount: number;
}

export interface ReplayStore {
  /** Chunks of this Flow in recorded order; none when storage cannot be read. */
  load(): Promise<ReplayChunk[]>;
  append(chunk: ReplayChunk): void;
  /** How many events the document before had recorded when it was left, if it could say. */
  findProgress(): ReplayProgress | null;
  saveProgress(progress: ReplayProgress): void;
  /** Keeps the chunks IndexedDB has not confirmed yet, synchronously, for the next document. Meant for pagehide. */
  stashPending(): void;
  /** Removes the replay. Nothing is written afterwards. */
  clear(): Promise<void>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      throw new DOMException('IndexedDB is unavailable.', 'NotSupportedError');
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME).createIndex(SAVED_AT, SAVED_AT);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openReplayStore(projectKey: string, sessionId: string): ReplayStore {
  const progressKey = `lattice-feedback:flow-replay:${projectKey}`;
  const stashKey = `lattice-feedback:flow-replay-tail:${projectKey}:${sessionId}`;
  const database = openDatabase();
  // Chunks handed to IndexedDB whose transaction has not completed.
  const pending = new Map<string, ReplayChunk>();
  let isWritable = true;

  // IndexedDB runs transactions on one store in the order they were created, so a clear always lands after
  // the writes issued before it.
  function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    return database
      .then((opened) => new Promise<T>((resolve, reject) => {
        const transaction = opened.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      }))
      .catch((error: unknown) => {
        // Storage can be absent, blocked or full. Writing stops, and the next document marks what is missing.
        if (!(error instanceof DOMException)) {
          throw error;
        }
        isWritable = false;
        return null;
      });
  }

  // An empty array sorts after every number, so this spans all chunks of the session.
  function getSessionRange(): IDBKeyRange {
    return IDBKeyRange.bound([projectKey, sessionId], [projectKey, sessionId, []]);
  }

  void transact('readwrite', (store) => {
    const expired = store.index(SAVED_AT).openKeyCursor(IDBKeyRange.upperBound(Date.now() - FLOW_MAX_DURATION_MS));
    expired.onsuccess = () => {
      if (expired.result) {
        store.delete(expired.result.primaryKey);
        expired.result.continue();
      }
    };
    return expired;
  });

  return {
    // The stash left by the document before is read once, merged in, and removed.
    load: () => transact('readonly', (store) => store.getAll(getSessionRange()) as IDBRequest<ReplayChunk[]>).then((chunks) => {
      const storage = findSessionStorage();
      let stashed: ReplayChunk[] = [];
      try {
        stashed = parseStashedChunks(storage?.getItem(stashKey) ?? null);
      } catch (error) {
        if (!(error instanceof DOMException)) throw error;
      }
      if (storage) clearFlowSession(storage, stashKey);
      return mergeStashedChunks(chunks ?? [], stashed);
    }),
    append(chunk) {
      if (!isWritable) {
        return;
      }
      const key = `${chunk.segment}:${chunk.index}`;
      pending.set(key, chunk);
      void transact('readwrite', (store) => store.put({ ...chunk, [SAVED_AT]: Date.now() }, [projectKey, sessionId, chunk.segment, chunk.index]))
        .then((written) => {
          if (written !== null) pending.delete(key);
        });
    },
    stashPending() {
      const storage = findSessionStorage();
      if (!storage || pending.size === 0) {
        return;
      }
      const text = JSON.stringify([...pending.values()]);
      if (text.length > MAX_STASH_CHARS) {
        return;
      }
      try {
        storage.setItem(stashKey, text);
      } catch (error) {
        // Without the stash the next document finds fewer events than the note says, and marks a gap.
        if (!(error instanceof DOMException)) throw error;
      }
    },
    // A note that is malformed or from another Flow matches nothing, which the recorder reads as a gap.
    findProgress() {
      const [savedSessionId, segment, eventCount] = (findSessionStorage()?.getItem(progressKey) ?? '').split(':');
      return savedSessionId === sessionId ? { segment: Number(segment), eventCount: Number(eventCount) } : null;
    },
    saveProgress({ segment, eventCount }) {
      try {
        findSessionStorage()?.setItem(progressKey, `${sessionId}:${segment}:${eventCount}`);
      } catch (error) {
        // Without the note the next document cannot tell that nothing was lost, and marks a gap.
        if (!(error instanceof DOMException)) throw error;
      }
    },
    clear() {
      isWritable = false;
      pending.clear();
      const storage = findSessionStorage();
      if (storage) {
        clearFlowSession(storage, progressKey);
        clearFlowSession(storage, stashKey);
      }
      return transact('readwrite', (store) => store.delete(getSessionRange())).then(() => undefined);
    },
  };
}
