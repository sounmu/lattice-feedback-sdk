import type { ElementTarget } from '@/types/feedback';

export class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  failWrites = false;
  failReads = false;
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null {
    if (this.failReads) throw new DOMException('blocked', 'SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('quota', 'QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string): void { this.items.delete(key); }
}

class FlowTestTarget extends EventTarget {
  constructor(readonly id: string, readonly value: string) { super(); }
}

export function createFlowTestTarget(id: string, value = ''): EventTarget {
  return new FlowTestTarget(id, value);
}

export function findFlowTestTarget(target: EventTarget | null, allowedIds: readonly string[]): ElementTarget | null {
  if (!(target instanceof FlowTestTarget) || !allowedIds.includes(target.id)) return null;
  return {
    selector: `[data-feedback-id="${target.id}"]`, feedbackId: target.id, tagName: 'button',
    rect: { x: 0, y: 0, width: 10, height: 10 },
  };
}

export function createFlowTestEvent(type: string, fields: Record<string, unknown>): Event {
  const event = new Event(type);
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
  return event;
}

export function createFlowNavigationEntry(type: string): PerformanceEntry & { type: string } {
  return { type, entryType: 'navigation', name: 'test', startTime: 0, duration: 0, toJSON: () => ({ type }) };
}

export function readStoredTestSession(storage: Storage, key: string): Record<string, unknown> | null {
  const text = storage.getItem(key);
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}
