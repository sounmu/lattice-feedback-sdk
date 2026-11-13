// Dependency-free runtime for the postMessage protocol. The SDK bundle imports this file,
// so it must not pull in zod or any other package.
import { isAssetFileList, isCapturedScreen, isScreenCaptureFailureReason } from '@/lib/screen-snapshot';
import type { FeedbackReporter, PageContext } from '@/types/feedback';
import {
  MESSAGE_SOURCE,
  PROTOCOL_VERSION,
  type HostToWidgetMessage,
  type HostToWidgetMessageType,
  type WidgetToHostMessage,
  type WidgetToHostMessageType,
} from '@/types/sdk-message';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isReporter(value: unknown): value is FeedbackReporter {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    return false;
  }
  return value.email === undefined || typeof value.email === 'string';
}

function isReporterOrNull(value: unknown): value is FeedbackReporter | null {
  return value === null || isReporter(value);
}

function isPageContext(value: unknown): value is PageContext {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    isFiniteNumber(value.viewportWidth) &&
    isFiniteNumber(value.viewportHeight) &&
    typeof value.userAgent === 'string'
  );
}

function hasEnvelope(value: unknown): value is UnknownRecord & { type: unknown; payload: UnknownRecord } {
  if (!isRecord(value)) {
    return false;
  }
  return value.source === MESSAGE_SOURCE && value.version === PROTOCOL_VERSION && isRecord(value.payload);
}

const MAX_REQUEST_ID_LENGTH = 64;

function isRequestId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_REQUEST_ID_LENGTH;
}

export function isHostToWidgetMessage(value: unknown): value is HostToWidgetMessage {
  if (!hasEnvelope(value)) {
    return false;
  }
  const payload = value.payload;
  switch (value.type) {
    case 'init':
      return typeof payload.projectKey === 'string' && isReporterOrNull(payload.reporter) && isPageContext(payload.page);
    case 'reporter:update':
      return isReporterOrNull(payload.reporter);
    case 'page:update':
      return isPageContext(payload.page);
    case 'screen:captured':
      return isRequestId(payload.requestId) && isCapturedScreen(payload.screen) && isAssetFileList(payload.assetFiles);
    case 'screen:capture-failed':
      return isRequestId(payload.requestId) && isScreenCaptureFailureReason(payload.reason);
    default:
      return false;
  }
}

export function isWidgetToHostMessage(value: unknown): value is WidgetToHostMessage {
  if (!hasEnvelope(value)) {
    return false;
  }
  switch (value.type) {
    case 'ready':
    case 'close':
      return true;
    case 'screen:capture':
    case 'flow:capture':
      return isRequestId(value.payload.requestId);
    case 'submitted':
      return typeof value.payload.feedbackId === 'string' && value.payload.feedbackId.length > 0;
    default:
      return false;
  }
}

type HostToWidgetMessageOf<T extends HostToWidgetMessageType> = Extract<HostToWidgetMessage, { type: T }>;
type WidgetToHostMessageOf<T extends WidgetToHostMessageType> = Extract<WidgetToHostMessage, { type: T }>;

export function createHostToWidgetMessage<T extends HostToWidgetMessageType>(
  type: T,
  payload: HostToWidgetMessageOf<T>['payload'],
): HostToWidgetMessageOf<T> {
  return { source: MESSAGE_SOURCE, version: PROTOCOL_VERSION, type, payload } as HostToWidgetMessageOf<T>;
}

export function createWidgetToHostMessage<T extends WidgetToHostMessageType>(
  type: T,
  payload: WidgetToHostMessageOf<T>['payload'],
): WidgetToHostMessageOf<T> {
  return { source: MESSAGE_SOURCE, version: PROTOCOL_VERSION, type, payload } as WidgetToHostMessageOf<T>;
}
