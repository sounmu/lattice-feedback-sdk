// Dependency-free runtime for the postMessage protocol. The SDK bundle imports this file,
// so it must not pull in zod or any other package.
import { isAssetFileList, isCapturedScreen, isScreenCaptureFailureReason } from '@/lib/screen-snapshot';
import type { FeedbackReporter, PageContext } from '@/types/feedback';
import { isReporterIdentity, isReporterOrganization } from '@/sdk/reporter';
import {
  MESSAGE_SOURCE,
  PROTOCOL_VERSION,
  type HostToWidgetMessage,
  type HostToWidgetMessageType,
  type PreviewConnectMessage,
  type PreviewContentMessage,
  type PreviewToHostMessage,
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
  if (value.identity !== undefined && !isReporterIdentity(value.identity)) return false;
  if (value.organization !== undefined && !isReporterOrganization(value.organization)) return false;
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
const MAX_PREVIEW_TEXT_LENGTH = 200;

function isRequestId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_REQUEST_ID_LENGTH;
}

function isPreviewText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PREVIEW_TEXT_LENGTH;
}

export function isHostToWidgetMessage(value: unknown): value is HostToWidgetMessage {
  if (!hasEnvelope(value)) {
    return false;
  }
  const payload = value.payload;
  switch (value.type) {
    case 'visibility:update':
      return typeof payload.isOpen === 'boolean';
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
    case 'preview:closed':
      return isRequestId(payload.previewId);
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
    case 'preview:close':
      return true;
    case 'screen:capture':
    case 'flow:capture':
      return isRequestId(value.payload.requestId);
    case 'preview:open':
      return isRequestId(value.payload.previewId);
    case 'submitted':
      return typeof value.payload.feedbackId === 'string' && value.payload.feedbackId.length > 0;
    default:
      return false;
  }
}

export function isPreviewToHostMessage(value: unknown): value is PreviewToHostMessage {
  return hasEnvelope(value) && (value.type === 'preview:ready' || value.type === 'preview:close');
}

export function isPreviewConnectMessage(value: unknown): value is PreviewConnectMessage {
  return hasEnvelope(value) && value.type === 'preview:connect';
}

// The screen and its files are held to the same limits as when the SDK first hands them to the widget.
export function isPreviewContentMessage(value: unknown): value is PreviewContentMessage {
  if (!hasEnvelope(value) || value.type !== 'preview:content') {
    return false;
  }
  const { title, subtitle, capture } = value.payload;
  return (
    isPreviewText(title) && title.length > 0 && isPreviewText(subtitle) &&
    isRecord(capture) && isCapturedScreen(capture.screen) && isAssetFileList(capture.assetFiles)
  );
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

type PreviewMessage = PreviewToHostMessage | PreviewConnectMessage | PreviewContentMessage;
type PreviewMessageOf<T extends PreviewMessage['type']> = Extract<PreviewMessage, { type: T }>;

/** Builds a message of the preview iframe's own exchanges: with the SDK, and with the widget over the port. */
export function createPreviewMessage<T extends PreviewMessage['type']>(
  type: T,
  payload: PreviewMessageOf<T>['payload'],
): PreviewMessageOf<T> {
  return { source: MESSAGE_SOURCE, version: PROTOCOL_VERSION, type, payload } as PreviewMessageOf<T>;
}
