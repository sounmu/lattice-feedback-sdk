import {
  createFlowSession,
  appendFlowEvent,
  clearFlowSession,
  findSessionStorage,
  getFlowSessionKey,
  isSafeFlowPath,
  isSafeTargetLabel,
  readFlowSession,
  toFlowAttachment,
  writeFlowSession,
} from '@/sdk/flow-session';
import { createFlowListeners, getDocumentNavigationType } from '@/sdk/flow-listeners';
import type { FlowNavigationType, FlowSessionPolicy, FlowSessionState, RecordedFlowAttachment, RecordedFlowEvent } from '@/sdk/flow-session';
import type { ElementTarget } from '@/types/feedback';

export interface FlowRecorderState {
  recording: boolean;
  eventCount: number;
  storageAvailable: boolean;
  errorMessage: string | null;
}

export interface FlowRecorderOptions extends FlowSessionPolicy {
  projectKey: string;
  isPageAllowed: () => boolean;
  findTarget: (target: EventTarget | null) => ElementTarget | null;
  onComplete: (attachment: RecordedFlowAttachment) => void;
  onStateChange: (state: FlowRecorderState) => void;
}

export interface FlowRecorder {
  start: () => void;
  stop: () => void;
  cancel: () => void;
  recordNavigation: () => void;
  destroy: () => void;
}

export const INPUT_THROTTLE_MS = 250;
const STORAGE_UNAVAILABLE_MESSAGE = '브라우저 저장소를 사용할 수 없어 새로고침이나 페이지 이동 후에는 Flow 기록이 이어지지 않습니다.';
const RESTORE_INVALID_MESSAGE = '이전 Flow 기록을 확인할 수 없어 삭제했습니다.';
const RESTORE_EXPIRED_MESSAGE = '이전 Flow 기록이 만료되어 삭제했습니다.';
const LIMIT_REACHED_MESSAGE = 'Flow 기록 한도에 도달해 기록을 자동으로 종료했습니다.';

const activeRecorderDisposers = new Map<string, () => void>();

type PendingFlowEvent = Omit<RecordedFlowEvent, 'offsetMs'>;

export function createFlowRecorder(options: FlowRecorderOptions): FlowRecorder {
  const storageKey = getFlowSessionKey(options.projectKey);
  activeRecorderDisposers.get(storageKey)?.();

  let session: FlowSessionState | null = null;
  let storage: Storage | null = null;
  let persistenceFailed = false;
  let errorMessage: string | null = null;
  let disposed = false;
  const lastInputTimes = new Map<string, number>();
  const listeners = createFlowListeners({
    onTarget: recordTargetEvent,
    onRestore: () => restoreFromStorage('document'),
  });

  function emitState(): void {
    options.onStateChange({
      recording: session !== null,
      eventCount: session?.events.length ?? 0,
      storageAvailable: storage !== null,
      errorMessage,
    });
  }

  function persist(): void {
    if (!session || !storage) {
      return;
    }
    if (!writeFlowSession(storage, storageKey, session)) {
      storage = null;
      persistenceFailed = true;
      errorMessage = STORAGE_UNAVAILABLE_MESSAGE;
    }
  }

  function syncListeners(): void {
    listeners.setActive(session !== null && !disposed);
  }

  function endSession(): void {
    session = null;
    lastInputTimes.clear();
    syncListeners();
  }

  function eraseStorage(): void {
    const target = storage ?? findSessionStorage();
    if (target && !clearFlowSession(target, storageKey)) {
      storage = null;
      errorMessage = STORAGE_UNAVAILABLE_MESSAGE;
    }
  }

  function complete(now: number): void {
    if (!session) {
      return;
    }
    const attachment = toFlowAttachment(session, now);
    eraseStorage();
    endSession();
    emitState();
    options.onComplete(attachment);
  }

  function completeTruncated(now: number): void {
    if (session) {
      session.truncated = true;
      errorMessage = LIMIT_REACHED_MESSAGE;
    }
    complete(now);
  }

  function findAllowedPath(): string | null {
    if (!session) {
      return null;
    }
    const path = window.location.pathname;
    if (options.isPageAllowed() && isSafeFlowPath(path)) {
      return path;
    }
    if (!session.interrupted) {
      session.interrupted = true;
      persist();
      emitState();
    }
    return null;
  }

  function append(pending: PendingFlowEvent, now: number): void {
    if (!session) {
      return;
    }
    const next = appendFlowEvent(session, pending, now);
    if (!next) {
      completeTruncated(now);
      return;
    }
    session = next;
    persist();
    emitState();
  }

  function recordTargetEvent(type: 'click' | 'input', eventTarget: EventTarget | null): void {
    const path = findAllowedPath();
    const label = options.findTarget(eventTarget)?.feedbackId;
    if (path === null || !isSafeTargetLabel(label) || !options.isTargetAllowed(label)) {
      return;
    }
    const now = Date.now();
    if (type === 'input') {
      const lastTime = lastInputTimes.get(label);
      if (lastTime !== undefined && now >= lastTime && now - lastTime < INPUT_THROTTLE_MS) {
        return;
      }
      lastInputTimes.set(label, now);
    }
    append({ type, path, targetLabel: label }, now);
  }

  function recordPageNavigation(navigationType: FlowNavigationType): void {
    const path = findAllowedPath();
    if (path === null || !session) {
      return;
    }
    const previous = session.events[session.events.length - 1];
    if (navigationType === 'spa' && previous?.type === 'navigation' && previous.path === path) {
      return;
    }
    append({ type: 'navigation', path, targetLabel: null, navigationType }, Date.now());
  }

  function restoreFromStorage(navigationType: FlowNavigationType): void {
    if (persistenceFailed && session) {
      return;
    }
    storage = findSessionStorage();
    if (!storage) {
      if (session) {
        errorMessage = STORAGE_UNAVAILABLE_MESSAGE;
      }
      emitState();
      return;
    }
    let result;
    try {
      result = readFlowSession(storage, storageKey, options, Date.now());
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      storage = null;
      errorMessage = STORAGE_UNAVAILABLE_MESSAGE;
      emitState();
      return;
    }
    session = result.kind === 'restored' ? result.state : null;
    if (result.kind === 'discarded') {
      errorMessage = result.reason === 'expired' ? RESTORE_EXPIRED_MESSAGE : RESTORE_INVALID_MESSAGE;
    }
    syncListeners();
    if (session) {
      recordPageNavigation(navigationType);
    }
    emitState();
  }

  function dispose(): void {
    disposed = true;
    syncListeners();
    if (activeRecorderDisposers.get(storageKey) === dispose) {
      activeRecorderDisposers.delete(storageKey);
    }
  }

  activeRecorderDisposers.set(storageKey, dispose);
  restoreFromStorage(getDocumentNavigationType());

  return {
    start(): void {
      if (disposed || session) {
        return;
      }
      const now = Date.now();
      session = createFlowSession(now, !options.isPageAllowed());
      storage = findSessionStorage();
      persistenceFailed = false;
      errorMessage = storage ? null : STORAGE_UNAVAILABLE_MESSAGE;
      persist();
      syncListeners();
      emitState();
    },
    stop(): void {
      if (!disposed) {
        complete(Date.now());
      }
    },
    cancel(): void {
      if (disposed) {
        return;
      }
      eraseStorage();
      endSession();
      emitState();
    },
    recordNavigation(): void {
      if (!disposed) {
        recordPageNavigation('spa');
      }
    },
    destroy(): void {
      if (disposed) {
        return;
      }
      eraseStorage();
      endSession();
      dispose();
    },
  };
}
