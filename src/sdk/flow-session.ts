// Persistence for an active Flow recording so it survives reloads and full-document
// navigation in the same tab + origin (sessionStorage). Only sanitized, bounded Flow
// metadata is stored: pathname, allowed target ids, event types and offsets. Never
// text, values, query strings, hashes, HTML, attributes, or other draft attachments.
import type { FlowAttachment, FlowEvent } from '@/types/feedback';
import { MAX_FLOW_EVENTS } from '@/lib/feedback-limits';

export type FlowNavigationType = NonNullable<FlowEvent['navigationType']>;

export type RecordedFlowEvent = FlowEvent;
export type RecordedFlowAttachment = FlowAttachment;

export const FLOW_SESSION_VERSION = 1;
export { MAX_FLOW_EVENTS } from '@/lib/feedback-limits';
export const MAX_FLOW_SESSION_BYTES = 32 * 1024;
export const FLOW_INACTIVITY_TTL_MS = 30 * 60 * 1000;
export const FLOW_MAX_DURATION_MS = 60 * 60 * 1000;

const MAX_PATH_LENGTH = 2048;
const TARGET_LABEL_PATTERN = /^[a-z][a-z0-9-]{0,119}$/;
const SESSION_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const EVENT_TYPES: readonly FlowEvent['type'][] = ['click', 'navigation', 'input'];
const NAVIGATION_TYPES: readonly FlowNavigationType[] = ['spa', 'document', 'reload'];

export interface FlowSessionState {
  version: typeof FLOW_SESSION_VERSION;
  sessionId: string;
  /** Wall-clock epoch ms; offsets are measured from it across documents. */
  startedAtMs: number;
  lastActivityAtMs: number;
  /** Largest offset handed out so far; offsets never go below it (monotonic across documents). */
  lastOffsetMs: number;
  events: RecordedFlowEvent[];
  truncated: boolean;
  interrupted: boolean;
}

export interface FlowSessionPolicy {
  isPathAllowed: (path: string) => boolean;
  isTargetAllowed: (id: string) => boolean;
}

export type FlowSessionReadResult =
  | { kind: 'empty' }
  | { kind: 'restored'; state: FlowSessionState }
  | { kind: 'discarded'; reason: 'invalid' | 'expired' };

export function getFlowSessionKey(projectKey: string): string {
  return `lattice-feedback:flow:${projectKey}`;
}

export function findSessionStorage(): Storage | null {
  try {
    return window.sessionStorage ?? null;
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

export function isSafeFlowPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && value.length <= MAX_PATH_LENGTH && !/[?#]/.test(value);
}

export function isSafeTargetLabel(value: unknown): value is string {
  return typeof value === 'string' && TARGET_LABEL_PATTERN.test(value);
}

export function isFlowSessionExpired(state: FlowSessionState, now: number): boolean {
  return now - state.lastActivityAtMs > FLOW_INACTIVITY_TTL_MS || now - state.startedAtMs > FLOW_MAX_DURATION_MS;
}

export function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function serializeFlowSession(state: FlowSessionState): string {
  return JSON.stringify(state);
}

export function createFlowSession(now: number, interrupted: boolean): FlowSessionState {
  return {
    version: FLOW_SESSION_VERSION,
    sessionId: `${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    startedAtMs: now,
    lastActivityAtMs: now,
    lastOffsetMs: 0,
    events: [],
    truncated: false,
    interrupted,
  };
}

export function appendFlowEvent(
  state: FlowSessionState,
  event: Omit<FlowEvent, 'offsetMs'>,
  now: number,
): FlowSessionState | null {
  if (isFlowSessionExpired(state, now) || state.events.length >= MAX_FLOW_EVENTS) return null;
  const offsetMs = Math.max(state.lastOffsetMs, Math.round(now - state.startedAtMs));
  const next: FlowSessionState = {
    ...state,
    events: [...state.events, { ...event, offsetMs }],
    lastOffsetMs: offsetMs,
    lastActivityAtMs: Math.max(state.lastActivityAtMs, now),
  };
  return getUtf8ByteLength(serializeFlowSession(next)) <= MAX_FLOW_SESSION_BYTES ? next : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findStoredEvent(value: unknown, policy: FlowSessionPolicy): RecordedFlowEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value;
  const type = EVENT_TYPES.find((eventType) => eventType === candidate.type);
  if (!type || !isNonNegativeInteger(candidate.offsetMs) || !isSafeFlowPath(candidate.path) || !policy.isPathAllowed(candidate.path)) {
    return null;
  }
  if (type === 'navigation') {
    const navigationType = NAVIGATION_TYPES.find((allowed) => allowed === candidate.navigationType);
    if (candidate.targetLabel !== null || !navigationType) {
      return null;
    }
    return { type, offsetMs: candidate.offsetMs, path: candidate.path, targetLabel: null, navigationType };
  }
  if (!isSafeTargetLabel(candidate.targetLabel) || !policy.isTargetAllowed(candidate.targetLabel) || candidate.navigationType !== undefined) {
    return null;
  }
  return { type, offsetMs: candidate.offsetMs, path: candidate.path, targetLabel: candidate.targetLabel };
}

function findStoredState(value: unknown, policy: FlowSessionPolicy): FlowSessionState | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value;
  if (candidate.version !== FLOW_SESSION_VERSION || typeof candidate.sessionId !== 'string' || !SESSION_ID_PATTERN.test(candidate.sessionId)) {
    return null;
  }
  const { startedAtMs, lastActivityAtMs, lastOffsetMs, events, truncated, interrupted } = candidate;
  if (!isNonNegativeInteger(startedAtMs) || !isNonNegativeInteger(lastActivityAtMs) || !isNonNegativeInteger(lastOffsetMs)) {
    return null;
  }
  if (!Number.isFinite(new Date(startedAtMs).getTime()) ||
    !Number.isFinite(new Date(lastActivityAtMs).getTime()) || lastOffsetMs > FLOW_MAX_DURATION_MS) return null;
  if (lastActivityAtMs < startedAtMs || typeof truncated !== 'boolean' || typeof interrupted !== 'boolean') {
    return null;
  }
  if (!Array.isArray(events) || events.length > MAX_FLOW_EVENTS) {
    return null;
  }
  const restoredEvents: RecordedFlowEvent[] = [];
  let previousOffset = 0;
  for (const storedEvent of events) {
    const event = findStoredEvent(storedEvent, policy);
    if (!event || event.offsetMs < previousOffset || event.offsetMs > lastOffsetMs) {
      return null;
    }
    previousOffset = event.offsetMs;
    restoredEvents.push(event);
  }
  return {
    version: FLOW_SESSION_VERSION,
    sessionId: candidate.sessionId,
    startedAtMs,
    lastActivityAtMs,
    lastOffsetMs,
    events: restoredEvents,
    truncated,
    interrupted,
  };
}

/** Reads and revalidates a stored session. Invalid or expired state is removed, never restored. */
export function readFlowSession(storage: Storage, key: string, policy: FlowSessionPolicy, now: number): FlowSessionReadResult {
  const text = storage.getItem(key);
  if (text === null) {
    return { kind: 'empty' };
  }
  let state: FlowSessionState | null = null;
  if (getUtf8ByteLength(text) <= MAX_FLOW_SESSION_BYTES) {
    try {
      state = findStoredState(JSON.parse(text), policy);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }
  if (!state) {
    storage.removeItem(key);
    return { kind: 'discarded', reason: 'invalid' };
  }
  if (isFlowSessionExpired(state, now)) {
    storage.removeItem(key);
    return { kind: 'discarded', reason: 'expired' };
  }
  return { kind: 'restored', state };
}

/** Returns false when storage rejects the write (quota, blocked); the stale copy is removed best-effort. */
export function writeFlowSession(storage: Storage, key: string, state: FlowSessionState): boolean {
  try {
    storage.setItem(key, serializeFlowSession(state));
    return true;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    clearFlowSession(storage, key);
    return false;
  }
}

export function clearFlowSession(storage: Storage, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return false;
  }
}

export function toFlowAttachment(state: FlowSessionState, endedAtMs: number): RecordedFlowAttachment {
  const attachment: RecordedFlowAttachment = {
    startedAt: new Date(state.startedAtMs).toISOString(),
    endedAt: new Date(Math.max(endedAtMs, state.startedAtMs + state.lastOffsetMs)).toISOString(),
    events: state.events.map((event) => ({ ...event })),
  };
  if (state.truncated) {
    attachment.truncated = true;
  }
  if (state.interrupted) {
    attachment.interrupted = true;
  }
  return attachment;
}
